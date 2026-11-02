/**
 * Audited single-path writer for the OJS database.
 *
 * digitopub writes to OJS ONLY through the functions in this file, and EVERY
 * write is audited in audit_ojs_writes (success or failure), audit row first:
 *   - writeOrcidToOjsWithAudit: ORCID backfill (UIET-P1), only when
 *     ENABLE_ORCID_OJS_BACKFILL=true.
 *   - setJournalSpecializationInOjsWithAudit: journal specialization (#234),
 *     through the OJS user bridge. Called by the OJS sync queue.
 *   - updatePersonInOjsWithAudit: an author's name, email and ORCID iD on
 *     their OJS account and every byline (#233), through the OJS user bridge.
 */

import { createHash, randomUUID } from "node:crypto"
import { prisma } from "./db/config"
import { getOjsConnection, postToUserBridge, type UserBridgeResult } from "@/src/features/ojs/server/ojs-client"
import { getFlagsEnv } from "./env"

export interface WriteOrcidInput {
  orcid: string
  ojsUserId: number | bigint
  /** Caller-supplied request id (defaults to a fresh UUID). */
  requestId?: string
}

export interface WriteOrcidResult {
  success: boolean
  /** Was a real write attempted? Returns false when flag is OFF or row already existed. */
  attempted: boolean
  auditId: bigint | null
  error?: string
}

export function isBackfillEnabled(): boolean {
  return getFlagsEnv().ENABLE_ORCID_OJS_BACKFILL
}

/**
 * Write ORCID into OJS user_settings, audit-first.
 *
 * Order of operations:
 *   1. INSERT audit_ojs_writes with success=NULL (planned).
 *   2. INSERT INTO user_settings on OJS.
 *   3. UPDATE audit_ojs_writes SET success=true (or success=false on failure).
 *
 * Idempotency: if the OJS row already exists, we still write an audit row
 * marked success=true but `attempted=false`.
 */
export async function writeOrcidToOjsWithAudit(
  input: WriteOrcidInput
): Promise<WriteOrcidResult> {
  if (!isBackfillEnabled()) {
    return { success: false, attempted: false, auditId: null }
  }

  const requestId = input.requestId ?? randomUUID()
  const ojsUserIdBigInt =
    typeof input.ojsUserId === "bigint" ? input.ojsUserId : BigInt(input.ojsUserId)
  const columnSet = `setting_name='orcid'; setting_value='${input.orcid}'`

  // 1) Plan the write — audit row with success=NULL.
  const auditRow = await prisma.auditOjsWrite.create({
    data: {
      request_id: requestId,
      orcid: input.orcid,
      ojs_user_id: ojsUserIdBigInt,
      ojs_table: "user_settings",
      ojs_column_set: columnSet,
      reason: "orcid_backfill",
    },
    select: { id: true },
  })

  let conn: Awaited<ReturnType<typeof getOjsConnection>> | null = null
  try {
    conn = await getOjsConnection()

    // Pre-check: if an ORCID setting row already exists for this user, skip.
    const [existing] = (await conn.query(
      "SELECT user_id FROM user_settings WHERE user_id = ? AND setting_name = 'orcid' LIMIT 1",
      [Number(ojsUserIdBigInt)]
    )) as [Array<{ user_id: number }>, unknown]

    if (Array.isArray(existing) && existing.length > 0) {
      await prisma.auditOjsWrite.update({
        where: { id: auditRow.id },
        data: {
          success: true,
          resolved_at: new Date(),
          error: "row_exists_skipped",
        },
      })
      return { success: true, attempted: false, auditId: auditRow.id }
    }

    await conn.query(
      "INSERT INTO user_settings (user_id, locale, setting_name, setting_value) VALUES (?, '', 'orcid', ?)",
      [Number(ojsUserIdBigInt), input.orcid]
    )

    await prisma.auditOjsWrite.update({
      where: { id: auditRow.id },
      data: { success: true, resolved_at: new Date() },
    })
    return { success: true, attempted: true, auditId: auditRow.id }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[ojs-write-guard] OJS write failed for orcid=${input.orcid}: ${message}`)
    try {
      await prisma.auditOjsWrite.update({
        where: { id: auditRow.id },
        data: { success: false, resolved_at: new Date(), error: message.slice(0, 1000) },
      })
    } catch {
      /* swallow — we already logged */
    }
    return { success: false, attempted: true, auditId: auditRow.id, error: message }
  } finally {
    if (conn) {
      try {
        conn.release()
      } catch {
        /* ignore */
      }
    }
  }
}

export interface SetJournalSpecializationInput {
  /** OJS journals.journal_id (digitopub Journal.ojs_id). */
  ojsJournalId: number
  /** New specialization; null or "" removes the OJS setting. */
  value: string | null
  actorAdminId?: bigint | null
  requestId?: string
}

export interface SetJournalSpecializationResult {
  success: boolean
  auditId: bigint
  before?: string | null
  after?: string | null
  error?: string
  /** False when retrying the same request cannot succeed (e.g. 400/404). */
  retryable: boolean
}

/**
 * Store a journal's specialization in OJS (journal setting
 * `digitopubSpecialization`) via the bridge action set_journal_specialization.
 *
 *   1. INSERT audit_ojs_writes (success=NULL, after_value = intended value).
 *   2. POST to the OJS user bridge, once (the sync queue owns retries).
 *   3. UPDATE the audit row with the outcome and the value OJS held before.
 */
export async function setJournalSpecializationInOjsWithAudit(
  input: SetJournalSpecializationInput
): Promise<SetJournalSpecializationResult> {
  const value = input.value?.trim() || null
  const auditRow = await prisma.auditOjsWrite.create({
    data: {
      request_id: input.requestId ?? randomUUID(),
      ojs_table: "journal_settings",
      ojs_column_set: "setting_name='digitopubSpecialization'; locale=''",
      reason: "journal_specialization",
      target_type: "journal",
      target_id: String(input.ojsJournalId),
      actor_admin_id: input.actorAdminId ?? null,
      after_value: value,
    },
    select: { id: true },
  })

  const result = await postToUserBridge({
    action: "set_journal_specialization",
    journal_id: input.ojsJournalId,
    value,
  })

  if (result.ok) {
    const before = typeof result.data.before === "string" ? result.data.before : null
    const after = typeof result.data.after === "string" ? result.data.after : null
    await recordOutcome(auditRow.id, { success: true, resolved_at: new Date(), before_value: before, after_value: after })
    return { success: true, auditId: auditRow.id, before, after, retryable: false }
  }

  const error = result.status ? `HTTP ${result.status}: ${result.error}` : result.error
  console.error(`[ojs-write-guard] journal specialization write failed for ojs journal ${input.ojsJournalId}: ${error}`)
  await recordOutcome(auditRow.id, { success: false, resolved_at: new Date(), error: error.slice(0, 1000) })
  return { success: false, auditId: auditRow.id, error, retryable: result.retryable }
}

/** Fields of a person (#233); an omitted field is left as it is. `orcid: null` removes it. */
export interface PersonChanges {
  givenName?: string
  familyName?: string
  email?: string
  orcid?: string | null
}

export interface PersonValues {
  givenName: string | null
  familyName: string | null
  email: string
  orcid: string | null
}

export interface PersonUpdateSummary {
  /** OJS account of this person, if they have one. */
  account: { user_id: number } | null
  bylines: number
  publications: number
  changed_publications: number
  dois_marked_stale: number
  /** Distinct names on the account and bylines under this email; more than one may mean several people. */
  names: string[]
  before: PersonValues
  after: PersonValues
  warnings: string[]
}

export type PersonUpdateCode =
  | "invalid_input"
  | "invalid_orcid"
  | "not_found"
  | "email_in_use"
  | "orcid_in_use"
  /** Records with different names share the email; repeat with samePerson once confirmed. */
  | "ambiguous_person"
  | "unavailable"

export type PersonUpdateResult =
  | ({ success: true; auditId: bigint | null } & PersonUpdateSummary)
  | { success: false; auditId: bigint | null; code: PersonUpdateCode; error: string; names?: string[] }

export interface UpdatePersonInput {
  /** The person's current email (case-insensitive); identifies the account and every byline. */
  matchEmail: string
  changes: PersonChanges
  /** Confirmed that the differently named records under this email are one person. */
  samePerson?: boolean
  /** Exactly one actor: the admin, or (self-service) the signed-in ORCID iD. */
  actorAdminId?: bigint | null
  actorOrcid?: string | null
  requestId?: string
}

const PERSON_CODES: PersonUpdateCode[] = ["invalid_input", "invalid_orcid", "not_found", "email_in_use", "orcid_in_use", "ambiguous_person"]

/** Audit target id: no plaintext email in the indexed column. */
export function personTargetId(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex")
}

function bridgeFailure(result: Extract<UserBridgeResult, { ok: false }>): { code: PersonUpdateCode; error: string; names?: string[] } {
  const code = PERSON_CODES.find((c) => c === result.code) ?? "unavailable"
  const error = result.status ? `HTTP ${result.status}: ${result.error}` : result.error
  const names = Array.isArray(result.data?.names) ? result.data.names.map(String) : undefined
  return { code, error, ...(names ? { names } : {}) }
}

function toSummary(data: Record<string, unknown>): PersonUpdateSummary {
  return {
    account: (data.account as PersonUpdateSummary["account"]) ?? null,
    bylines: Number(data.bylines ?? 0),
    publications: Number(data.publications ?? 0),
    changed_publications: Number(data.changed_publications ?? 0),
    dois_marked_stale: Number(data.dois_marked_stale ?? 0),
    names: Array.isArray(data.names) ? data.names.map(String) : [],
    before: data.before as PersonValues,
    after: data.after as PersonValues,
    warnings: Array.isArray(data.warnings) ? data.warnings.map(String) : [],
  }
}

/**
 * What `updatePersonInOjsWithAudit` would do, without writing: the bridge
 * runs the update with dry_run and rolls it back. With no changes it returns
 * the person's current values. Reads only, so no audit row.
 */
export async function previewPersonUpdate(
  matchEmail: string,
  changes: PersonChanges = {},
  opts: { samePerson?: boolean } = {}
): Promise<PersonUpdateResult> {
  const result = await postToUserBridge({
    action: "update_person",
    match_email: matchEmail,
    ...changes,
    ...(opts.samePerson ? { same_person: true } : {}),
    dry_run: true,
  })
  if (!result.ok) return { success: false, auditId: null, ...bridgeFailure(result) }
  return { success: true, auditId: null, ...toSummary(result.data) }
}

/**
 * Edit a person's name, email and/or ORCID iD on their OJS account (if any)
 * and every byline with the same email, via the bridge action update_person.
 *
 *   1. INSERT audit_ojs_writes (success=NULL, after_value = requested changes).
 *   2. POST to the OJS user bridge, once.
 *   3. UPDATE the audit row with the outcome and the before/after values.
 *
 * An email change must already be confirmed by the new address's owner
 * (person-email-change service); this function does not check that.
 */
export async function updatePersonInOjsWithAudit(input: UpdatePersonInput): Promise<PersonUpdateResult> {
  const fields = Object.keys(input.changes)
  const auditRow = await prisma.auditOjsWrite.create({
    data: {
      request_id: input.requestId ?? randomUUID(),
      orcid: input.actorOrcid ?? null,
      ojs_table: "users,user_settings,authors,author_settings,dois",
      ojs_column_set: `fields=${fields.join(",")}${input.samePerson ? "; same_person" : ""}`,
      reason: "person_update",
      target_type: "person",
      target_id: personTargetId(input.matchEmail),
      actor_admin_id: input.actorAdminId ?? null,
      after_value: JSON.stringify(input.changes),
    },
    select: { id: true },
  })

  const result = await postToUserBridge({
    action: "update_person",
    match_email: input.matchEmail,
    ...input.changes,
    ...(input.samePerson ? { same_person: true } : {}),
  })

  if (result.ok) {
    const summary = toSummary(result.data)
    await recordOutcome(auditRow.id, {
      success: true,
      resolved_at: new Date(),
      ojs_user_id: summary.account ? BigInt(summary.account.user_id) : null,
      before_value: JSON.stringify(summary.before),
      after_value: JSON.stringify({ ...summary.after, bylines: summary.bylines, dois_marked_stale: summary.dois_marked_stale }),
    })
    return { success: true, auditId: auditRow.id, ...summary }
  }

  const failure = bridgeFailure(result)
  console.error(`[ojs-write-guard] person update failed (${failure.code}): ${failure.error}`)
  await recordOutcome(auditRow.id, { success: false, resolved_at: new Date(), error: `${failure.code}: ${failure.error}`.slice(0, 1000) })
  return { success: false, auditId: auditRow.id, ...failure }
}

/** Resolve an audit row; callers must not report success if this fails. */
async function recordOutcome(
  id: bigint,
  data: {
    success: boolean
    resolved_at: Date
    error?: string
    before_value?: string | null
    after_value?: string | null
    ojs_user_id?: bigint | null
  }
): Promise<void> {
  await prisma.auditOjsWrite.update({ where: { id }, data })
}
