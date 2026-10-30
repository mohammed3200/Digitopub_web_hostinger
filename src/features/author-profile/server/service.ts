/**
 * Author edits (#233), shared by the admin editor and /account/profile.
 *
 * Name and ORCID changes are written to OJS at once (audited). An email
 * change is first checked against OJS (dry run: refused if the address
 * belongs to someone else), then waits for the new address to confirm.
 */

import { ojsQuery } from "@/src/features/ojs/server/ojs-client"
import {
  previewPersonUpdate,
  updatePersonInOjsWithAudit,
  type PersonChanges,
  type PersonUpdateCode,
  type PersonUpdateSummary,
} from "@/src/lib/ojs-write-guard"
import { requestEmailChange, type EmailChangeActor } from "./email-change"

export type EditOutcome =
  | {
      ok: true
      /** Name/ORCID changes written to OJS now (null when there were none). */
      applied: PersonUpdateSummary | null
      /** The new address a confirmation link was sent to (null when the email is unchanged). */
      confirmationSentTo: string | null
    }
  | { ok: false; status: 400 | 404 | 409 | 502 | 503; code: PersonUpdateCode | "email_not_sent"; error: string }

const STATUS: Record<PersonUpdateCode, 400 | 404 | 409 | 503> = {
  invalid_input: 400,
  invalid_orcid: 400,
  not_found: 404,
  email_in_use: 409,
  orcid_in_use: 409,
  unavailable: 503,
}

export function statusForCode(code: PersonUpdateCode): 400 | 404 | 409 | 503 {
  return STATUS[code]
}

const MESSAGES: Record<PersonUpdateCode, string> = {
  invalid_input: "Some of the values are not valid.",
  invalid_orcid: "That is not a valid ORCID iD.",
  not_found: "No OJS account or article byline uses this email.",
  email_in_use: "This email already belongs to another author in OJS.",
  orcid_in_use: "This ORCID iD already belongs to another author in OJS.",
  unavailable: "OJS could not be reached. Nothing was changed; try again later.",
}

export function messageForCode(code: PersonUpdateCode): string {
  return MESSAGES[code]
}

function failure(code: PersonUpdateCode): Extract<EditOutcome, { ok: false }> {
  return { ok: false, status: STATUS[code], code, error: MESSAGES[code] }
}

/**
 * Apply an edit to the person whose current email is `matchEmail`.
 * A case-only email change is applied directly; any other email change is
 * validated with a dry run and then sent for confirmation.
 */
export async function applyPersonEdit(input: {
  matchEmail: string
  changes: PersonChanges
  actor: EmailChangeActor
}): Promise<EditOutcome> {
  const { email, ...direct } = input.changes
  const newEmail = email && email.toLowerCase() !== input.matchEmail.trim().toLowerCase() ? email : null
  const changes: PersonChanges = { ...direct, ...(email && !newEmail ? { email } : {}) }

  if (newEmail) {
    const check = await previewPersonUpdate(input.matchEmail, { email: newEmail })
    if (!check.success) return failure(check.code)
  }

  let applied: PersonUpdateSummary | null = null
  if (Object.keys(changes).length > 0) {
    const result = await updatePersonInOjsWithAudit({
      matchEmail: input.matchEmail,
      changes,
      actorAdminId: input.actor.adminId ?? null,
      actorOrcid: input.actor.orcid ?? null,
    })
    if (!result.success) return failure(result.code)
    const { success: _s, auditId: _a, ...summary } = result
    applied = summary
  }

  if (newEmail) {
    const sent = await requestEmailChange({ oldEmail: input.matchEmail, newEmail, actor: input.actor })
    if (!sent.sent) {
      return {
        ok: false,
        status: 502,
        code: "email_not_sent",
        error: applied
          ? "The name/ORCID changes were saved, but the confirmation email for the new address could not be sent."
          : "The confirmation email for the new address could not be sent. Nothing was changed.",
      }
    }
  }

  return { ok: true, applied, confirmationSentTo: newEmail }
}

export type SelfEmailResult =
  | { ok: true; email: string }
  | { ok: false; status: 404 | 409 | 503; error: string }

/**
 * The OJS email of the signed-in author: their linked OJS account's email,
 * or else the one email shared by the bylines that carry their ORCID iD.
 * Read-only OJS queries.
 */
export async function resolveSelfEmail(identity: { orcid: string; ojs_user_id: number | null }): Promise<SelfEmailResult> {
  try {
    if (identity.ojs_user_id) {
      const rows = await ojsQuery<{ email: string }>("SELECT email FROM users WHERE user_id = ?", [identity.ojs_user_id])
      if (rows[0]?.email) return { ok: true, email: rows[0].email }
    }
    const rows = await ojsQuery<{ email: string }>(
      `SELECT DISTINCT LOWER(a.email) AS email
         FROM authors a
         JOIN author_settings s ON s.author_id = a.author_id AND s.setting_name = 'orcid'
        WHERE s.setting_value = ? AND a.email IS NOT NULL AND a.email <> ''`,
      [`https://orcid.org/${identity.orcid}`]
    )
    if (rows.length === 1) return { ok: true, email: rows[0].email }
    if (rows.length === 0) {
      return { ok: false, status: 404, error: "We found no OJS account or article with your ORCID iD. Contact the editorial office to link your record." }
    }
    return { ok: false, status: 409, error: "Your ORCID iD appears on articles under different emails. Contact the editorial office to merge them." }
  } catch (e) {
    console.error("[author-profile] resolving the signed-in author failed:", e instanceof Error ? e.message : e)
    return { ok: false, status: 503, error: messageForCode("unavailable") }
  }
}
