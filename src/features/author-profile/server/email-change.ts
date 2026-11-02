/**
 * Author email changes (#233) wait for the new address to confirm.
 *
 * requestEmailChange stores a pending row (token hash only) and emails a
 * single-use link to the NEW address; OJS is not touched. confirmEmailChange
 * claims the row once, then writes the email to OJS through the audited
 * updatePersonInOjsWithAudit, and tells the OLD address it changed. A
 * mistyped address therefore never reaches OJS.
 */

import { createHash, randomBytes } from "node:crypto"
import { prisma } from "@/src/lib/db/config"
import { sendEmail } from "@/src/lib/email/service"
import { escapeHtml } from "@/src/lib/email/renderer"
import { previewPersonUpdate, updatePersonInOjsWithAudit, type PersonUpdateCode } from "@/src/lib/ojs-write-guard"

export const EMAIL_CHANGE_TTL_MS = 24 * 60 * 60 * 1000
/** Pending and used rows are kept this long, then deleted. */
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000

export interface EmailChangeActor {
  adminId?: bigint | null
  /** Bare ORCID iD of the signed-in author (self-service). */
  orcid?: string | null
}

export function hashEmailChangeToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/$/, "")
}

/**
 * Store a pending change and email the confirmation link to `newEmail`.
 * Replaces an earlier unconfirmed request for the same person. Callers check
 * beforehand (bridge dry run) that the new address is free in OJS.
 */
export async function requestEmailChange(input: {
  oldEmail: string
  newEmail: string
  actor: EmailChangeActor
  /** Admin only: the differently named records under oldEmail are one person. */
  samePerson?: boolean
  now?: Date
}): Promise<{ sent: boolean; expiresAt: Date }> {
  const now = input.now ?? new Date()
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_TTL_MS)
  const oldEmail = input.oldEmail.trim().toLowerCase()

  await prisma.personEmailChange.deleteMany({
    where: { OR: [{ old_email: oldEmail, confirmed_at: null }, { created_at: { lt: new Date(now.getTime() - RETENTION_MS) } }] },
  })
  const row = await prisma.personEmailChange.create({
    data: {
      token_hash: hashEmailChangeToken(token),
      old_email: oldEmail,
      new_email: input.newEmail.trim(),
      requested_by_admin_id: input.actor.adminId ?? null,
      requested_by_orcid: input.actor.orcid ?? null,
      same_person: input.samePerson === true,
      expires_at: expiresAt,
    },
    select: { id: true },
  })

  const link = `${appUrl()}/account/confirm-email?token=${token}`
  const sent = await sendEmail({
    to: input.newEmail.trim(),
    subject: "Confirm your new email address for DigitoPub",
    html: `<p>A request was made to change the email address on your DigitoPub author record to this address.</p>
<p><a href="${escapeHtml(link)}">Confirm this email address</a></p>
<p>The link works once and expires in 24 hours. If you did not expect this, ignore this email and nothing will change.</p>`,
    text: `A request was made to change the email address on your DigitoPub author record to this address.\n\nConfirm it: ${link}\n\nThe link works once and expires in 24 hours. If you did not expect this, ignore this email and nothing will change.`,
  })
  if (!sent.success) {
    // An unsendable link is useless; don't leave a pending row behind.
    await prisma.personEmailChange.delete({ where: { id: row.id } }).catch(() => undefined)
    return { sent: false, expiresAt }
  }
  return { sent: true, expiresAt }
}

export type ConfirmEmailChangeResult =
  | { status: "confirmed"; newEmail: string }
  | { status: "invalid" | "expired" | "used" }
  | { status: "failed"; code: PersonUpdateCode }

/** Use a confirmation link: claim it once, then write the new email to OJS. */
export async function confirmEmailChange(token: string, now: Date = new Date()): Promise<ConfirmEmailChangeResult> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: "invalid" }
  const row = await prisma.personEmailChange.findUnique({ where: { token_hash: hashEmailChangeToken(token) } })
  if (!row) return { status: "invalid" }
  if (row.confirmed_at) return { status: "used" }
  if (row.expires_at <= now) return { status: "expired" }

  // Claim: only one request can move confirmed_at from NULL.
  const claimed = await prisma.personEmailChange.updateMany({
    where: { id: row.id, confirmed_at: null },
    data: { confirmed_at: now },
  })
  if (claimed.count === 0) return { status: "used" }

  let result: Awaited<ReturnType<typeof updatePersonInOjsWithAudit>>
  try {
    result = await updatePersonInOjsWithAudit({
      matchEmail: row.old_email,
      changes: { email: row.new_email },
      samePerson: row.same_person,
      actorAdminId: row.requested_by_admin_id,
      actorOrcid: row.requested_by_orcid,
    })
  } catch (e) {
    // Audit bookkeeping failed (our DB): release the claim so the link can be retried.
    const message = e instanceof Error ? e.message : String(e)
    await prisma.personEmailChange
      .update({ where: { id: row.id }, data: { confirmed_at: null, error: `audit: ${message}`.slice(0, 255) } })
      .catch(() => undefined)
    return { status: "failed", code: "unavailable" }
  }

  // A retry after a timeout: the earlier attempt may have committed in OJS
  // although we never saw the answer. The old email is gone and the new one
  // is there, so the change is done.
  if (!result.success && result.code === "not_found" && row.error?.startsWith("unavailable")) {
    const now = await previewPersonUpdate(row.new_email)
    if (now.success) result = { ...now, success: true }
  }

  if (!result.success) {
    await prisma.personEmailChange.update({
      where: { id: row.id },
      // OJS unreachable: release the claim so the same link can be retried.
      data: { error: `${result.code}: ${result.error}`.slice(0, 255), ...(result.code === "unavailable" ? { confirmed_at: null } : {}) },
    })
    return { status: "failed", code: result.code }
  }

  await sendEmail({
    to: row.old_email,
    subject: "Your DigitoPub author email address was changed",
    html: `<p>The email address on your DigitoPub author record was changed to <strong>${escapeHtml(row.new_email)}</strong>.</p>
<p>If you did not ask for this, contact the editorial office.</p>`,
    text: `The email address on your DigitoPub author record was changed to ${row.new_email}.\n\nIf you did not ask for this, contact the editorial office.`,
  }).catch(() => undefined)

  return { status: "confirmed", newEmail: row.new_email }
}
