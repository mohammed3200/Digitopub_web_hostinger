import { prisma } from "@/src/lib/db/config"
import { withDeadlockRetry } from "@/src/lib/db/deadlock-retry"
import { parseCustomDetails } from "../custom-details"
import {
  JOB_SET_JOURNAL_SPECIALIZATION,
  enqueueSyncJob,
  getLatestSyncJob,
  getLatestSyncJobsByTarget,
  retryLatestSyncJob,
  runSyncJob,
} from "@/src/features/ojs/server/ojs-sync-jobs"
import type {
  SpecializationItem,
  SpecializationSyncStatus,
  SpecializationUpdate,
} from "@/src/features/journals/schemas/specialization-schema"

/**
 * Journal specialization (#234). Journal.field holds the chosen name; the
 * names come from journal_specializations. Every change to a linked journal
 * (one with an ojs_id) queues an OJS sync job in the same transaction as the
 * change, then attempts it once right away.
 */

export class SpecializationError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409) {
    super(message)
  }
}

const TARGET = "journal"

type Db = Parameters<Parameters<typeof prisma.$transaction>[0]>[0]
type QueuedJob = Awaited<ReturnType<typeof enqueueSyncJob>>

export async function listSpecializations(opts: { includeInactive: boolean }): Promise<SpecializationItem[]> {
  const [specs, usage] = await Promise.all([
    prisma.journalSpecialization.findMany({
      where: opts.includeInactive ? {} : { is_active: true },
      orderBy: [{ sort_order: "asc" }, { name: "asc" }],
    }),
    prisma.journal.groupBy({ by: ["field"], _count: { _all: true } }),
  ])
  const counts = new Map(usage.map((u) => [u.field.toLowerCase(), u._count._all]))
  return specs.map((s) => ({
    id: s.id.toString(),
    name: s.name,
    sort_order: s.sort_order,
    is_active: s.is_active,
    usage_count: counts.get(s.name.toLowerCase()) ?? 0,
  }))
}

export async function createSpecialization(input: { name: string; sort_order?: number }) {
  const existing = await findByName(input.name)
  if (existing) throw new SpecializationError(`"${existing.name}" already exists`, 409)
  return prisma.journalSpecialization.create({
    data: { name: input.name, sort_order: input.sort_order ?? 500 },
  })
}

/** Lock and return the canonical active name for `name`, or a 400. */
export async function requireActiveSpecialization(name: string, db: Db): Promise<string> {
  const rows = await db.$queryRaw<Array<{ name: string }>>`
    SELECT name FROM journal_specializations WHERE name = ${name.trim()} AND is_active = TRUE FOR UPDATE
  `
  const spec = rows[0]
  if (!spec) throw new SpecializationError(`"${name}" is not an active specialization`, 400)
  return spec.name
}

/**
 * Rename, reorder or retire a specialization. A rename rewrites Journal.field
 * on every journal using the old name and queues an OJS sync for each linked
 * one, all in one transaction; the OJS attempts then run in parallel.
 * Retiring keeps existing journals as they are; the name can no longer be chosen.
 * The durable default used for newly discovered journals cannot be retired.
 */
export async function updateSpecialization(id: bigint, input: SpecializationUpdate, actorAdminId: bigint | null) {
  const { updated, affected, jobs } = await withDeadlockRetry(async (tx) => {
    const specRows = await tx.$queryRaw<Array<{ name: string; is_default: boolean | number }>>`
      SELECT name, is_default FROM journal_specializations WHERE id = ${id} FOR UPDATE
    `
    const spec = specRows[0]
    if (!spec) throw new SpecializationError("Specialization not found", 404)
    if (spec.is_default && input.is_active === false) {
      throw new SpecializationError("The default specialization cannot be retired", 400)
    }

    const renamed = input.name !== undefined && input.name !== spec.name
    if (renamed) {
      const clash = await tx.journalSpecialization.findFirst({ where: { name: input.name!.trim() } })
      if (clash && clash.id !== id) throw new SpecializationError(`"${clash.name}" already exists`, 409)
    }

    // Locking reads serialize concurrent renames and rename-versus-journal
    // updates, so every queued payload comes from the committed cascade.
    const affected = renamed
      ? await tx.$queryRaw<Array<{ id: bigint; ojs_id: string | null }>>`
          SELECT id, ojs_id FROM journals WHERE field = ${spec.name} FOR UPDATE
        `
      : []
    const updated = await tx.journalSpecialization.update({
      where: { id },
      data: { name: input.name, sort_order: input.sort_order, is_active: input.is_active },
    })
    if (renamed) {
      await tx.journal.updateMany({ where: { field: spec.name }, data: { field: input.name! } })
    }
    const jobs: QueuedJob[] = []
    for (const journal of affected) {
      if (journal.ojs_id) jobs.push(await queue(tx, journal.id, journal.ojs_id, updated.name, actorAdminId))
    }
    return { updated, affected, jobs }
  })

  await attemptAll(jobs)
  return { specialization: updated, journalsUpdated: affected.length }
}

/** Set a journal's specialization from the active list, then sync it to OJS. */
export async function setJournalSpecialization(journalId: bigint, name: string, actorAdminId: bigint | null) {
  const { canonical, journal, job } = await withDeadlockRetry(async (tx) => {
    const canonical = await requireActiveSpecialization(name, tx)
    const journalRows = await tx.$queryRaw<Array<{ ojs_id: string | null }>>`
      SELECT ojs_id FROM journals WHERE id = ${journalId} FOR UPDATE
    `
    const journal = journalRows[0]
    if (!journal) throw new SpecializationError("Journal not found", 404)

    await tx.journal.update({ where: { id: journalId }, data: { field: canonical } })
    const job = journal.ojs_id ? await queue(tx, journalId, journal.ojs_id, canonical, actorAdminId) : null
    return { canonical, journal, job }
  })

  if (!job) return { journal_id: journalId.toString(), field: canonical, sync: notLinked() }
  // First attempt right away so the admin usually sees "synced" at once.
  await runSyncJob(job.id)
  return { journal_id: journalId.toString(), field: canonical, sync: await getJournalSyncStatus(journalId, journal.ojs_id) }
}

/**
 * Queue every linked journal's current specialization for OJS (backfill when
 * the feature goes live, or after OJS was restored from a backup).
 */
export async function pushAllSpecializationsToOjs(actorAdminId: bigint | null) {
  const jobs = await withDeadlockRetry(async (tx) => {
    const journals = await tx.$queryRaw<Array<{ id: bigint; ojs_id: string; field: string }>>`
      SELECT id, ojs_id, field FROM journals WHERE ojs_id IS NOT NULL ORDER BY id FOR UPDATE
    `
    const queued: QueuedJob[] = []
    for (const j of journals) queued.push(await queue(tx, j.id, j.ojs_id!, j.field, actorAdminId))
    return queued
  })
  await attemptAll(jobs)

  const statuses = await getAllJournalSyncStatuses()
  const counts = { queued: jobs.length, synced: 0, pending: 0, failed: 0 }
  for (const job of jobs) {
    const state = statuses[job.target_id]?.state
    if (state === "synced") counts.synced++
    else if (state === "failed") counts.failed++
    else counts.pending++
  }
  return counts
}

/** One journal by its numeric digitopub id, for the admin edit page. */
export async function getJournalSpecialization(journalId: bigint) {
  // Not resolveJournalRecord(): that tries ojs_id before the numeric id, and
  // in production digitopub ids and OJS ids differ for some journals (id 3
  // has ojs_id 4), so it can return a different journal than the one clicked.
  const journal = await prisma.journal.findUnique({
    where: { id: journalId },
    select: { id: true, title: true, field: true, ojs_id: true, ojs_path: true, invitation_scope: true, custom_details: true },
  })
  if (!journal) throw new SpecializationError("Journal not found", 404)
  return {
    journal_id: journal.id.toString(),
    title: journal.title,
    field: journal.field,
    ojs_id: journal.ojs_id,
    ojs_path: journal.ojs_path,
    invitation_scope: journal.invitation_scope,
    custom_details: parseCustomDetails(journal.custom_details),
    sync: await getJournalSyncStatus(journal.id, journal.ojs_id),
  }
}

export async function retryJournalSpecializationSync(journalId: bigint) {
  const journal = await prisma.journal.findUnique({ where: { id: journalId }, select: { id: true, ojs_id: true } })
  if (!journal) throw new SpecializationError("Journal not found", 404)
  if (!journal.ojs_id) return notLinked()
  await retryLatestSyncJob(JOB_SET_JOURNAL_SPECIALIZATION, TARGET, journalId.toString())
  return getJournalSyncStatus(journal.id, journal.ojs_id)
}

export async function getJournalSyncStatus(journalId: bigint, ojsId: string | null): Promise<SpecializationSyncStatus> {
  if (!ojsId) return notLinked()
  return toStatus(await getLatestSyncJob(JOB_SET_JOURNAL_SPECIALIZATION, TARGET, journalId.toString()))
}

/** Latest sync state for every journal that has one, keyed by journal id. */
export async function getAllJournalSyncStatuses(): Promise<Record<string, SpecializationSyncStatus>> {
  const jobs = await getLatestSyncJobsByTarget(JOB_SET_JOURNAL_SPECIALIZATION, TARGET)
  return Object.fromEntries(jobs.map((job) => [job.target_id, toStatus(job)]))
}

function queue(db: Db, journalId: bigint, ojsId: string, value: string, actorAdminId: bigint | null) {
  return enqueueSyncJob(
    {
      action: JOB_SET_JOURNAL_SPECIALIZATION,
      targetType: TARGET,
      targetId: journalId.toString(),
      payload: { ojs_journal_id: Number(ojsId), value },
      createdBy: actorAdminId,
    },
    db
  )
}

/**
 * One immediate attempt per job, in parallel: each targets a different
 * journal, and the bridge call has its own 10 s timeout, so a bulk change
 * waits ~10 s at worst instead of 10 s per journal. Failures stay queued.
 */
async function attemptAll(jobs: QueuedJob[]) {
  await Promise.allSettled(jobs.map((job) => runSyncJob(job.id)))
}

async function findByName(name: string) {
  // The column collation is case-insensitive, so this also catches
  // "dentistry" vs "Dentistry".
  return prisma.journalSpecialization.findFirst({ where: { name: name.trim() } })
}

type JobLike = {
  status: string
  attempts: number
  last_error: string | null
  next_attempt_at: Date
  completed_at: Date | null
  updated_at: Date
} | null

function toStatus(job: JobLike): SpecializationSyncStatus {
  if (!job) return { state: "never", attempts: 0, last_error: null, next_attempt_at: null, completed_at: null, updated_at: null }
  const state = job.status === "succeeded" ? "synced" : job.status === "failed" ? "failed" : "pending"
  return {
    state,
    attempts: job.attempts,
    last_error: job.last_error,
    next_attempt_at: state === "pending" ? job.next_attempt_at.toISOString() : null,
    completed_at: job.completed_at?.toISOString() ?? null,
    updated_at: job.updated_at.toISOString(),
  }
}

function notLinked(): SpecializationSyncStatus {
  return { state: "not_linked", attempts: 0, last_error: null, next_attempt_at: null, completed_at: null, updated_at: null }
}
