import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { requireAdmin } from "@/src/lib/auth-middleware"
import { parsePagination, paginatedResponse } from "@/src/lib/pagination"
import { serializeRecord, serializeMany } from "@/src/lib/serialize"
import { prisma } from "@/src/lib/db/config"
import { withDeadlockRetry } from "@/src/lib/db/deadlock-retry"
import { normalizeOjsAssetUrl } from "@/src/features/ojs/utils/ojs-config"
import { journalCreateSchema, journalUpdateSchema, journalIdParamSchema, journalSlugParamSchema } from "@/src/features/journals/schemas/journal-schema"
import { hostingRequestRouter } from "./hosting-request-route"
import { specializationRouter } from "./specialization-route"
import { SpecializationError, requireActiveSpecialization } from "./specialization-service"
import { resolveJournalRecord } from "./resolve-journal"
import { parseCustomDetails } from "../custom-details"
import { sanitizeCustomDetails } from "./custom-details-html"

const app = new Hono()

// ─── POST /journals/register — Public journal-hosting request (hotfix A5) ──
app.route("/", hostingRequestRouter)

// ─── /journals/specializations, /journals/:id/specialization (#234) ──
// Before GET /:id, which would otherwise take "specializations" as an id.
app.route("/", specializationRouter)

let runningFullSyncPromise: Promise<void> | null = null;

// ─── OJS drift self-heal ─────────────────────────────────────────────
// Once Prisma has >=1 journal, journals added/edited/deleted in OJS would
// stay stale until an external cron (/api/ojs/sync) or manual
// `bun run ojs:sync` runs. The drift check below closes that gap: after
// every public listing response, we compare a cheap fingerprint of the OJS
// journal rows and mirrored settings against the value stored at last
// successful sync; on mismatch we fire a single-flight background sync.
// Unlike the previous count-only comparison, this detects deletions and
// content edits, not just additions. Set OJS_DRIFT_FINGERPRINT=0 to
// fall back to the legacy count-only comparison (kept for one release).
// Throttled to avoid hammering the OJS DB.
let lastOjsDriftCheckTs = 0;
let pendingDriftCheckPromise: Promise<void> | null = null;
const DEFAULT_DRIFT_CHECK_INTERVAL_MS = 5 * 60 * 1000;

function getDriftCheckIntervalMs(): number {
  const raw = process.env.OJS_DRIFT_CHECK_INTERVAL_MS;
  if (raw === undefined || raw === "") return DEFAULT_DRIFT_CHECK_INTERVAL_MS;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_DRIFT_CHECK_INTERVAL_MS;
}

/**
 * Test-only hook to reset the module-level self-heal state. Not exported via
 * the feature barrel; only consumed by Vitest specs.
 */
export function __resetOjsDriftCheckStateForTests(): void {
  lastOjsDriftCheckTs = 0;
  runningFullSyncPromise = null;
  pendingDriftCheckPromise = null;
}

/**
 * Test-only hook: awaits the currently pending fire-and-forget drift check
 * (including any background sync it launched) so specs can assert its
 * effects deterministically instead of sleeping. Resolves immediately when
 * nothing is pending.
 */
export async function __waitForOjsDriftCheckForTests(): Promise<void> {
  await pendingDriftCheckPromise;
}

function scheduleOjsDriftCheck(prismaTotal: number): void {
  if (runningFullSyncPromise) return;
  const interval = getDriftCheckIntervalMs();
  // 0 disables the self-heal entirely (opt-out switch).
  if (interval === 0) return;
  if (Date.now() - lastOjsDriftCheckTs < interval) return;
  lastOjsDriftCheckTs = Date.now();

  pendingDriftCheckPromise = (async () => {
    try {
      const { isOjsConfigured, ojsQuery } = await import("@/src/features/ojs/server/ojs-client");
      if (!isOjsConfigured()) return;

      let driftDetected: boolean;
      let driftReason: string;
      let capturedFingerprint: string | undefined;
      if (process.env.OJS_DRIFT_FINGERPRINT === "0") {
        // Legacy additions-only comparison (fallback flag, one release).
        const rows = await ojsQuery<{ c: number }>("SELECT COUNT(*) AS c FROM journals");
        const ojsTotal = Number(rows?.[0]?.c ?? 0);
        driftDetected = ojsTotal > prismaTotal;
        driftReason = `OJS=${ojsTotal} > Prisma=${prismaTotal}`;
      } else {
        const { computeOjsJournalsFingerprint, getStoredJournalsFingerprint } = await import("@/src/features/ojs/server/sync-ojs-journals");
        const [current, stored] = await Promise.all([
          computeOjsJournalsFingerprint(),
          getStoredJournalsFingerprint(),
        ]);
        capturedFingerprint = current;
        driftDetected = current !== stored;
        driftReason = `fingerprint ${stored ?? "<none>"} -> ${current}`;
      }
      if (!driftDetected) return;

      if (runningFullSyncPromise) return;
      console.log(`[journals/self-heal] Drift detected (${driftReason}). Triggering single-flight background sync.`);
      runningFullSyncPromise = (async () => {
        try {
          const { fetchFromDatabase } = await import("@/src/features/ojs/server/ojs-service");
          const { syncOjsJournals } = await import("@/src/features/ojs/server/sync-ojs-journals");
          const { withSyncRun } = await import("@/src/features/ojs/server/sync-runs");
          const result = await withSyncRun("ojs_journals_sync", "drift", async () => {
            const ojsData = await fetchFromDatabase(true);
            const syncResult = await syncOjsJournals(ojsData, {
              deactivateMissing: true,
              fingerprint: capturedFingerprint,
            });
            return {
              status: syncResult.errors > 0 ? ("partial" as const) : ("success" as const),
              stats: { ...syncResult },
              result: syncResult,
            };
          });
          console.log(`[journals/self-heal] Background sync complete: synced=${result.synced}, errors=${result.errors}, deactivated=${result.deactivated.length}`);

          // Also refresh the per-journal aggregate snapshots (article/issue
          // counts, lifetime views/downloads). Best-effort and watermark-gated:
          // a failure here must never fail the journal sync. Without this, the
          // drift path — the only sync that runs on this host — leaves
          // ojs_journal_snapshots stale at zero.
          try {
            const { refreshOjsJournalSnapshots } = await import("@/src/features/ojs/server/ojs-journal-snapshots");
            // force:true — the submissions/publications/issues watermark is
            // independent of the journal fingerprint that triggered this drift
            // sync, so without force a journal-only change would skip the
            // snapshot refresh and leave article/view/download counts stale.
            const snap = await refreshOjsJournalSnapshots({ force: true });
            console.log(`[journals/self-heal] Snapshot refresh: refreshed=${snap.refreshed}, skipped=${snap.skipped}`);
          } catch (snapErr) {
            console.error("[journals/self-heal] Snapshot refresh failed (non-fatal):", snapErr);
          }
        } catch (syncError) {
          console.error("[journals/self-heal] Background sync failed:", syncError);
        } finally {
          runningFullSyncPromise = null;
        }
      })();
      // Fold the sync into this promise so the test hook can await the full
      // chain; production callers never await either promise.
      await runningFullSyncPromise;
    } catch (err) {
      console.error("[journals/self-heal] Drift check failed:", err);
    }
  })();
}

const LIST_JOURNAL_SELECT = {
  id: true,
  title: true,
  abbreviation: true,
  issn: true,
  e_issn: true,
  description: true,
  field: true,
  publisher: true,
  editor_in_chief: true,
  frequency: true,
  submission_fee: true,
  publication_fee: true,
  cover_image_url: true,
  website_url: true,
  status: true,
  created_at: true,
  updated_at: true,
  created_by: true,
  ojs_id: true,
  ojs_path: true,
} as const

const DETAIL_JOURNAL_SELECT = {
  ...LIST_JOURNAL_SELECT,
  aims_and_scope: true,
  author_guidelines: true,
  custom_details: true,
} as const

// ─── GET /journals/debug-covers (TEMPORARY FOR OJS SCHEMA) ──────────
app.get("/debug-covers", requireAdmin, async (c) => {
  try {
    const { ojsQuery } = await import("@/src/features/ojs/server/ojs-client")

    const [issueSettings, isCovers, pubSettings, pubCovers] = await Promise.all([
      ojsQuery("SELECT DISTINCT setting_name FROM issue_settings WHERE setting_name LIKE '%cover%'"),
      ojsQuery("SELECT * FROM issue_settings WHERE setting_name = 'coverImage' LIMIT 5"),
      ojsQuery("SELECT DISTINCT setting_name FROM publication_settings WHERE setting_name LIKE '%cover%'"),
      ojsQuery("SELECT * FROM publication_settings WHERE setting_name = 'coverImage' LIMIT 5")
    ])

    return c.json({
      success: true,
      data: { issueSettings, isCovers, pubSettings, pubCovers }
    })
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    return c.json({ success: false, error: errorMsg }, 500)
  }
})

// ─── GET /journals — Public listing (Prisma only) ───────────────────

app.get("/", async (c) => {
  try {
    const pagination = parsePagination(c)
    const [journals, total] = await Promise.all([
      prisma.journal.findMany({
        select: LIST_JOURNAL_SELECT,
        orderBy: { created_at: "desc" },
        take: pagination.limit,
        skip: pagination.offset,
      }),
      prisma.journal.count(),
    ])

    // Cold start (empty Prisma mirror): kick off a background sync via the
    // same single-flight machinery the drift check uses and return the empty
    // page immediately. The previous behavior blocked this request on a full
    // OJS fetch — a live-OJS dependency on the request path that turned any
    // whitelist flap or OJS outage into a 500 for every first visitor.
    if (total === 0 && runningFullSyncPromise === null) {
      const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")
      if (isOjsConfigured()) {
        // Bypass the drift throttle: an empty mirror is always worth a sync.
        lastOjsDriftCheckTs = 0
      }
    }

    // Self-heal: fire-and-forget OJS drift check so journals added in OJS
    // after the first cold-start become visible without manual sync. Never
    // blocks this response; throttled and single-flight internally.
    scheduleOjsDriftCheck(total)

    const serialized = (serializeMany(journals) as Array<Record<string, unknown>>).map((j) => ({
      ...j,
      cover_image_url: normalizeOjsAssetUrl(j.cover_image_url as string | null | undefined),
    }))
    return c.json(paginatedResponse(serialized, total, pagination), 200)
  } catch (error) {
    console.error("Error fetching journals:", error)
    return c.json({ success: false, error: "Failed to fetch journals" }, 500)
  }
})



// ─── GET /journals/:id — Public detail (supports slug, ojs_id, or numeric id) ──

app.get("/:id", zValidator("param", journalSlugParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    // Resolve via ojs_path (slug), ojs_id, or numeric Prisma id
    let journal = await resolveJournalRecord(id)

    // 4. Safe OJS Fallback: Generate a complete mock journal and trigger background sync.
    if (!journal) {
      const { resolveJournalOjsId } = await import("@/src/features/journals/server/resolve-journal");
      const resolved = await resolveJournalOjsId(id);

      if (resolved.found && resolved.ojsId) {
        console.log(`[Journal Detail API] Journal not found locally for "${id}", but exists remotely (id=${resolved.ojsId}). Triggering background sync...`);
        
        // Single-flight background sync
        if (!runningFullSyncPromise) {
          runningFullSyncPromise = (async () => {
            try {
              const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client");
              if (isOjsConfigured()) {
                const { fetchFromDatabase } = await import("@/src/features/ojs/server/ojs-service");
                const { computeOjsJournalsFingerprint, syncOjsJournals } = await import("@/src/features/ojs/server/sync-ojs-journals");
                console.time(`[Journal Detail API] Background Sync "${id}"`);
                // Capture before the fetch; parallelizing can falsely mark newer OJS content as synced.
                const fingerprint = await computeOjsJournalsFingerprint();
                if (!fingerprint) {
                  throw new Error("Failed to capture OJS journal fingerprint");
                }
                const ojsData = await fetchFromDatabase(true);
                await syncOjsJournals(ojsData, { fingerprint });
                console.timeEnd(`[Journal Detail API] Background Sync "${id}"`);
              }
            } catch (syncError) {
              console.error(`[Journal Detail API] Background sync fallback failed for "${id}":`, syncError);
            } finally {
              runningFullSyncPromise = null;
            }
          })();
        }

        const uppercaseTitle = id.replace(/[-_]/g, ' ').replace(/\b\w/g, char => char.toUpperCase());

        // Construct exact structural match to DETAIL_JOURNAL_SELECT
        const mockJournal = {
          id: BigInt(-1), // Temporary frontend ID
          title: uppercaseTitle,
          abbreviation: null,
          issn: null,
          e_issn: null,
          description: null,
          field: null,
          publisher: null,
          editor_in_chief: null,
          frequency: null,
          submission_fee: 0,
          publication_fee: 0,
          cover_image_url: null,
          website_url: null,
          status: "active",
          created_at: new Date(),
          updated_at: new Date(),
          created_by: BigInt(-1),
          ojs_id: resolved.ojsId,
          ojs_path: resolved.ojsPath ?? null,
          aims_and_scope: null,
          author_guidelines: null,
          custom_details: [],
          contact_email: undefined,
          primary_locale: "en_US",
          theme_config: null,
          partial: true // Downstream detection flag for missing data
        };

        const serializedMock = serializeRecord(mockJournal as any) as ReturnType<typeof serializeRecord> & { contact_email?: string };
        
        return c.json({
          success: true,
          data: serializedMock,
        }, 200)
      }

      const notFoundPrefix = resolved.found ? "Local entry exists but OJS reference missing" : "Complete failure finding journal";
      console.warn(`[Journal Detail API] ${notFoundPrefix} for "${id}". Returns 404.`);
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    // invitation_scope is admin-only email copy (#231); the record here is unselected.
    const { invitation_scope: _invitationScope, ...publicJournal } = journal
    // #288: custom detail values are rendered as HTML by the public card; clean them on every read.
    const serializedJournal = serializeRecord({
      ...publicJournal,
      custom_details: sanitizeCustomDetails(parseCustomDetails(publicJournal.custom_details)),
    }) as ReturnType<typeof serializeRecord> & { contact_email?: string; cover_image_url?: string | null }
    serializedJournal.cover_image_url = normalizeOjsAssetUrl(serializedJournal.cover_image_url)

    if (journal.ojs_id) {
      try {
        const { isOjsConfigured, ojsQuery } = await import("@/src/features/ojs/server/ojs-client")
        if (isOjsConfigured()) {
          const settings = await ojsQuery<{ setting_name: string, setting_value: string }>(
            "SELECT setting_name, setting_value FROM journal_settings WHERE journal_id = ? AND setting_name = 'contactEmail' LIMIT 1",
            [journal.ojs_id]
          )
          if (settings.length > 0 && settings[0].setting_value) {
            serializedJournal.contact_email = settings[0].setting_value
          }
        }
      } catch (err) {
        console.warn("[Journal API] Failed to fetch contactEmail from OJS:", err)
      }
    }

    return c.json({ success: true, data: serializedJournal }, 200)
  } catch (error) {
    console.error("Error fetching journal:", error)
    return c.json({ success: false, error: "Failed to fetch journal" }, 500)
  }
})

// ─── GET /journals/:id/stats — Real-time OJS Metrics ─────────────────

app.get("/:id/stats", zValidator("param", journalSlugParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    let journal = await resolveJournalRecord(id)

    if (!journal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    if (!journal.ojs_id) {
      return c.json({ success: true, data: { articles: 0, issues: 0 }, message: "No OJS data" }, 200)
    }

    const { isOjsConfigured, ojsQuery } = await import("@/src/features/ojs/server/ojs-client")

    if (!isOjsConfigured()) {
      return c.json({ success: true, data: { articles: 0, issues: 0 }, message: "No OJS data" }, 200)
    }

    try {
      // Run queries in parallel
      const [articlesResult, issuesResult] = await Promise.all([
        ojsQuery<{ count: number }>('SELECT CAST(COUNT(*) AS UNSIGNED) as count FROM submissions WHERE context_id = ? AND status = 3', [journal.ojs_id]),
        ojsQuery<{ count: number }>('SELECT CAST(COUNT(*) AS UNSIGNED) as count FROM issues WHERE journal_id = ? AND published = 1', [journal.ojs_id])
      ])

      const articles = Number(articlesResult?.[0]?.count || 0)
      const issues = Number(issuesResult?.[0]?.count || 0)

      return c.json({ success: true, data: { articles, issues } }, 200)
    } catch (queryError) {
      console.error("OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch OJS stats" }, 502)
    }
  } catch (error) {
    console.error("Error fetching journal stats:", error)
    return c.json({ success: false, error: "Failed to fetch journal stats" }, 500)
  }
})

// ─── GET /journals/:id/current-issue — Current Issue from OJS ────────

app.get("/:id/current-issue", zValidator("param", journalSlugParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    let journal = await resolveJournalRecord(id)

    if (!journal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    if (!journal.ojs_id) {
      return c.json({ success: true, data: null, message: "No OJS data" }, 200)
    }

    const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")

    if (!isOjsConfigured()) {
      return c.json({ success: true, data: null, message: "OJS not configured" }, 200)
    }

    try {
      const { fetchCurrentIssue } = await import("./current-issue-service")
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[CurrentIssue API] Calling fetchCurrentIssue with ojs_id="${journal.ojs_id}" (resolved from param="${id}", prisma_id=${journal.id})`)
      }
      const currentIssue = await fetchCurrentIssue(journal.ojs_id)
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[CurrentIssue API] Result: ${currentIssue ? `issue_id=${currentIssue.issueId}, articles=${currentIssue.articles.length}` : "null"}`)
      }
      return c.json({ success: true, data: currentIssue }, 200)
    } catch (queryError) {
      console.error("[CurrentIssue API] OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch current issue from OJS" }, 502)
    }
  } catch (error) {
    console.error("Error fetching current issue:", error)
    return c.json({ success: false, error: "Failed to fetch current issue" }, 500)
  }
})

// ─── GET /journals/:id/archive — Archive Issues from OJS ────────────

app.get("/:id/archive", zValidator("param", journalSlugParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    let journal = await resolveJournalRecord(id)

    if (!journal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    if (!journal.ojs_id) {
      return c.json({ success: true, data: [], message: "No OJS data" }, 200)
    }

    const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")

    if (!isOjsConfigured()) {
      return c.json({ success: true, data: [], message: "OJS not configured" }, 200)
    }

    try {
      const { fetchArchiveIssues } = await import("./archive-issue-service")
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Archive API] Calling fetchArchiveIssues with ojs_id="${journal.ojs_id}" (resolved from param="${id}")`)
      }
      const archiveIssues = await fetchArchiveIssues(journal.ojs_id)
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Archive API] Result: ${archiveIssues.length} archive issues`)
      }
      return c.json({ success: true, data: archiveIssues }, 200)
    } catch (queryError) {
      console.error("[Archive API] OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch archive issues from OJS" }, 502)
    }
  } catch (error) {
    console.error("Error fetching archive issues:", error)
    return c.json({ success: false, error: "Failed to fetch archive issues" }, 500)
  }
})

// ─── GET /journals/:id/editorial-board — OJS Masthead Members ────────

app.get("/:id/editorial-board", zValidator("param", journalSlugParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    let journal = await resolveJournalRecord(id)

    if (!journal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    if (!journal.ojs_id) {
      return c.json({ success: true, data: { members: [] }, message: "No OJS data" }, 200)
    }

    const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")

    if (!isOjsConfigured()) {
      return c.json({ success: true, data: { members: [] }, message: "OJS not configured" }, 200)
    }

    try {
      const { fetchEditorialBoard } = await import("@/src/features/journals/server/editorial-board-service")
      const members = await fetchEditorialBoard(journal.ojs_id)
      return c.json({ success: true, data: { members } }, 200)
    } catch (queryError) {
      console.error("[EditorialBoard API] OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch editorial board from OJS" }, 502)
    }
  } catch (error) {
    console.error("Error fetching editorial board:", error)
    return c.json({ success: false, error: "Failed to fetch editorial board" }, 500)
  }
})

// ─── GET /journals/:id/advisory-board — OJS Hand-authored Advisory Board ────

app.get("/:id/advisory-board", zValidator("param", journalSlugParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    let journal = await resolveJournalRecord(id)

    if (!journal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    if (!journal.ojs_id) {
      return c.json({ success: true, data: { members: [] }, message: "No OJS data" }, 200)
    }

    const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")

    if (!isOjsConfigured()) {
      return c.json({ success: true, data: { members: [] }, message: "OJS not configured" }, 200)
    }

    try {
      const { fetchAdvisoryBoard } = await import("@/src/features/journals/server/advisory-board-service")
      const members = await fetchAdvisoryBoard(journal.ojs_id)
      return c.json({ success: true, data: { members } }, 200)
    } catch (queryError) {
      console.error("[AdvisoryBoard API] OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch advisory board from OJS" }, 502)
    }
  } catch (error) {
    console.error("Error fetching advisory board:", error)
    return c.json({ success: false, error: "Failed to fetch advisory board" }, 500)
  }
})

// ─── GET /journals/:id/custom-blocks — OJS Custom Block Manager ───────

app.get("/:id/custom-blocks", zValidator("param", journalSlugParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    let journal = await resolveJournalRecord(id)

    if (!journal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    if (!journal.ojs_id) {
      return c.json({ success: true, data: { blocks: [] }, message: "No OJS data" }, 200)
    }

    const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")

    if (!isOjsConfigured()) {
      return c.json({ success: true, data: { blocks: [] }, message: "OJS not configured" }, 200)
    }

    try {
      // Resolve primary locale for block content localisation
      const { getJournalPrimaryLocale } = await import("@/src/features/ojs/server/ojs-client")
      const primaryLocale = await getJournalPrimaryLocale(journal.ojs_id, "en_US")

      const { fetchCustomBlocks } = await import("@/src/features/journals/server/custom-blocks-service")
      const blocks = await fetchCustomBlocks(journal.ojs_id, primaryLocale)
      return c.json({ success: true, data: { blocks } }, 200)
    } catch (queryError) {
      console.error("[CustomBlocks API] OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch custom blocks from OJS" }, 502)
    }
  } catch (error) {
    console.error("Error fetching custom blocks:", error)
    return c.json({ success: false, error: "Failed to fetch custom blocks" }, 500)
  }
})

// ─── GET /journals/:id/policies — OJS Journal Policy Content ──────────

app.get("/:id/policies", zValidator("param", journalSlugParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    let journal = await resolveJournalRecord(id)

    if (!journal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    if (!journal.ojs_id) {
      return c.json({ success: true, data: null, message: "No OJS data" }, 200)
    }

    const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")

    if (!isOjsConfigured()) {
      return c.json({ success: true, data: null, message: "OJS not configured" }, 200)
    }

    try {
      const { fetchJournalPolicies } = await import("@/src/features/journals/server/journal-policies-service")
      const policies = await fetchJournalPolicies(journal.ojs_id)
      return c.json({ success: true, data: policies }, 200)
    } catch (queryError) {
      console.error("[Policies API] OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch policies from OJS" }, 502)
    }
  } catch (error) {
    console.error("Error fetching journal policies:", error)
    return c.json({ success: false, error: "Failed to fetch journal policies" }, 500)
  }
})

// ─── GET /journals/:id/about-content — Aims/Scope extracted from OJS About page ──

app.get("/:id/about-content", zValidator("param", journalSlugParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    let journal = await resolveJournalRecord(id)

    if (!journal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    if (!journal.ojs_id) {
      return c.json({ success: true, data: null, message: "No OJS data" }, 200)
    }

    const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")
    if (!isOjsConfigured()) {
      return c.json({ success: true, data: null, message: "OJS not configured" }, 200)
    }

    try {
      const { fetchJournalAboutContent } = await import("@/src/features/journals/server/about-content-service")
      const about = await fetchJournalAboutContent(journal.ojs_id)
      return c.json({ success: true, data: about }, 200)
    } catch (queryError) {
      console.error("[AboutContent API] OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch about content from OJS" }, 502)
    }
  } catch (error) {
    console.error("Error fetching about content:", error)
    return c.json({ success: false, error: "Failed to fetch about content" }, 500)
  }
})

// ─── GET /journals/:id/fees — Publication Fees content sourced from OJS ──

app.get("/:id/fees", zValidator("param", journalSlugParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    let journal = await resolveJournalRecord(id)

    if (!journal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    if (!journal.ojs_id) {
      return c.json({ success: true, data: null, message: "No OJS data" }, 200)
    }

    const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")
    if (!isOjsConfigured()) {
      return c.json({ success: true, data: null, message: "OJS not configured" }, 200)
    }

    try {
      const { fetchJournalPublicationFees } = await import("@/src/features/journals/server/publication-fees-service")
      const fees = await fetchJournalPublicationFees(journal.ojs_id)
      return c.json({ success: true, data: fees }, 200)
    } catch (queryError) {
      console.error("[Fees API] OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch publication fees from OJS" }, 502)
    }
  } catch (error) {
    console.error("Error fetching publication fees:", error)
    return c.json({ success: false, error: "Failed to fetch publication fees" }, 500)
  }
})

const journalIssueParamSchema = z.object({
  id: z.string().min(1),
  issueId: z.string().regex(/^\d+$/, "Issue ID must be numeric")
})

app.get("/:id/issues/:issueId", zValidator("param", journalIssueParamSchema), async (c) => {
  try {
    const { id, issueId: rawIssueId } = c.req.valid("param")
    const issueId = parseInt(rawIssueId, 10)

    let journal = await resolveJournalRecord(id)

    if (!journal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    if (!journal.ojs_id) {
      return c.json({ success: true, data: null, message: "No OJS data" }, 200)
    }

    const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")

    if (!isOjsConfigured()) {
      return c.json({ success: true, data: null, message: "OJS not configured" }, 200)
    }

    try {
      const { fetchIssueWithArticles } = await import("./archive-issue-service")
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[IssueDetail API] Calling fetchIssueWithArticles(ojs_id="${journal.ojs_id}", issueId=${issueId})`)
      }
      const issueDetail = await fetchIssueWithArticles(journal.ojs_id, issueId)
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[IssueDetail API] Result: ${issueDetail ? `issue_id=${issueDetail.issueId}, articles=${issueDetail.articles.length}` : "null"}`)
      }
      return c.json({ success: true, data: issueDetail }, 200)
    } catch (queryError) {
      console.error("[IssueDetail API] OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch issue detail from OJS" }, 502)
    }
  } catch (error) {
    console.error("Error fetching issue detail:", error)
    return c.json({ success: false, error: "Failed to fetch issue detail" }, 500)
  }
})

const journalArticleParamSchema = z.object({
  id: z.string().min(1),
  publicationId: z.string().regex(/^\d+$/, "Publication ID must be numeric")
})

app.get("/:id/articles/:publicationId", zValidator("param", journalArticleParamSchema), async (c) => {
  try {
    const { id, publicationId: rawPubId } = c.req.valid("param")
    const publicationId = parseInt(rawPubId, 10)

    const { resolveJournalOjsId } = await import("@/src/features/journals/server/resolve-journal");
    const resolved = await resolveJournalOjsId(id);

    if (!resolved.found) {
      console.warn(`[ArticleDetail API] Resolution failed for journal "${id}". Returns 404.`);
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    const resolvedOjsId = resolved.ojsId;

    if (!resolvedOjsId) {
      return c.json({ success: true, data: null, message: "No OJS data" }, 200)
    }

    const { isOjsConfigured } = await import("@/src/features/ojs/server/ojs-client")

    if (!isOjsConfigured()) {
      return c.json({ success: true, data: null, message: "OJS not configured" }, 200)
    }

    try {
      const { fetchArticleDetail } = await import("./article-detail-service")
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[ArticleDetail API] Calling fetchArticleDetail(ojs_id="${resolvedOjsId}", pubId=${publicationId})`)
      }
      const detail = await fetchArticleDetail(resolvedOjsId, publicationId)

      if (!detail) {
        return c.json({ success: false, error: "Article not found" }, 404)
      }
      return c.json({ success: true, data: detail }, 200)
    } catch (queryError) {
      console.error("[ArticleDetail API] OJS Query Error:", queryError)
      return c.json({ success: false, error: "Failed to fetch article detail from OJS" }, 502)
    }
  } catch (error) {
    console.error("Error fetching article detail:", error)
    return c.json({ success: false, error: "Failed to fetch article detail" }, 500)
  }
})

// ─── POST /journals — Admin create (Prisma only) ────────────────────



app.post("/", requireAdmin, zValidator("json", journalCreateSchema), async (c) => {
  try {
    const session = c.get("session" as never) as { id: string } | undefined
    if (!session) {
      return c.json({ success: false, error: "Unauthorized" }, 401)
    }
    const data = c.req.valid("json")
    const journal = await withDeadlockRetry(async (tx) => {
      const field = await requireActiveSpecialization(data.field, tx)
      return tx.journal.create({
        data: {
          title: data.title,
          abbreviation: data.abbreviation || null,
          issn: data.issn || null,
          e_issn: data.e_issn || null,
          description: data.description || null,
          field,
          publisher: data.publisher || null,
          editor_in_chief: data.editor_in_chief || null,
          frequency: data.frequency || null,
          submission_fee: data.submission_fee || 0,
          publication_fee: data.publication_fee || 0,
          cover_image_url: data.cover_image_url || null,
          website_url: data.website_url || null,
          status: data.status || "active",
          created_by: BigInt(session.id),
        },
        select: DETAIL_JOURNAL_SELECT,
      })
    })

    return c.json(
      { success: true, data: serializeRecord(journal), message: "Journal created successfully" },
      201
    )
  } catch (error) {
    if (error instanceof SpecializationError) return c.json({ success: false, error: error.message }, error.status)
    console.error("Error creating journal:", error)
    return c.json({ success: false, error: "Failed to create journal" }, 500)
  }
})

// ─── PATCH /journals/:id — Admin update (Prisma only) ───────────────

app.patch("/:id", requireAdmin, zValidator("param", journalIdParamSchema), zValidator("json", journalUpdateSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")
    const data = c.req.valid("json")

    const existingJournal = await prisma.journal.findUnique({
      where: { id: BigInt(id) },
      select: { id: true },
    })

    if (!existingJournal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    const updateData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        updateData[key] = value
      }
    }

    // #288: store only sanitized HTML. A value with no text left after cleaning is an error, not a silent drop.
    if (data.custom_details) {
      const clean = sanitizeCustomDetails(data.custom_details)
      if (clean.length !== data.custom_details.length) {
        return c.json({ success: false, error: "Each field needs a value" }, 400)
      }
      updateData.custom_details = clean
    }

    const journal = await prisma.journal.update({
      where: { id: BigInt(id) },
      data: updateData,
      select: DETAIL_JOURNAL_SELECT,
    })

    return c.json(
      { success: true, data: serializeRecord(journal), message: "Journal updated successfully" },
      200
    )
  } catch (error) {
    console.error("Error updating journal:", error)
    return c.json({ success: false, error: "Failed to update journal" }, 500)
  }
})

// ─── DELETE /journals/:id — Admin delete (Prisma only) ──────────────

app.delete("/:id", requireAdmin, zValidator("param", journalIdParamSchema), async (c) => {
  try {
    const { id } = c.req.valid("param")

    const existingJournal = await prisma.journal.findUnique({
      where: { id: BigInt(id) },
      select: { id: true },
    })

    if (!existingJournal) {
      return c.json({ success: false, error: "Journal not found" }, 404)
    }

    await prisma.journal.delete({
      where: { id: BigInt(id) },
    })

    return c.json({ success: true, message: "Journal deleted successfully" }, 200)
  } catch (error) {
    console.error("Error deleting journal:", error)
    return c.json({ success: false, error: "Failed to delete journal" }, 500)
  }
})

export { app as journalRouter }
