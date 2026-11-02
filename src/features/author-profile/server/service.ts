/**
 * Author edits (#233), shared by the admin editor and /account/profile.
 *
 * Name and ORCID changes are written to OJS at once (audited). An email
 * change is first checked against OJS (dry run: refused if the address
 * belongs to someone else), then waits for the new address to confirm.
 */

import { ojsQuery } from "@/src/features/ojs/server/ojs-client"
import { emailHash } from "@/src/lib/email-hash"
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
  | {
      ok: false
      status: 400 | 404 | 409 | 502 | 503
      code: PersonUpdateCode | "email_not_sent"
      error: string
      /** ambiguous_person: the different names found under the email. */
      names?: string[]
    }

const STATUS: Record<PersonUpdateCode, 400 | 404 | 409 | 503> = {
  invalid_input: 400,
  invalid_orcid: 400,
  not_found: 404,
  email_in_use: 409,
  orcid_in_use: 409,
  ambiguous_person: 409,
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
  ambiguous_person:
    "Records with different names use this email, so it may belong to more than one person. Nothing was changed.",
  unavailable: "OJS could not be reached. Nothing was changed; try again later.",
}

export function messageForCode(code: PersonUpdateCode): string {
  return MESSAGES[code]
}

function failure(code: PersonUpdateCode, names?: string[]): Extract<EditOutcome, { ok: false }> {
  return { ok: false, status: STATUS[code], code, error: MESSAGES[code], ...(names ? { names } : {}) }
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
  /** Admin only: confirmed that the differently named records under this email are one person. */
  samePerson?: boolean
}): Promise<EditOutcome> {
  const { email, ...direct } = input.changes
  const newEmail = email && email.toLowerCase() !== input.matchEmail.trim().toLowerCase() ? email : null
  const changes: PersonChanges = { ...direct, ...(email && !newEmail ? { email } : {}) }

  if (newEmail) {
    const check = await previewPersonUpdate(input.matchEmail, { email: newEmail }, { samePerson: input.samePerson })
    if (!check.success) return failure(check.code, check.names)
  }

  let applied: PersonUpdateSummary | null = null
  if (Object.keys(changes).length > 0) {
    const result = await updatePersonInOjsWithAudit({
      matchEmail: input.matchEmail,
      changes,
      samePerson: input.samePerson,
      actorAdminId: input.actor.adminId ?? null,
      actorOrcid: input.actor.orcid ?? null,
    })
    if (!result.success) return failure(result.code, result.names)
    const { success: _s, auditId: _a, ...summary } = result
    applied = summary
  }

  if (newEmail) {
    const sent = await requestEmailChange({
      oldEmail: input.matchEmail,
      newEmail,
      actor: input.actor,
      samePerson: input.samePerson,
    })
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
  | { ok: false; status: 404 | 503; error: string }

/**
 * The OJS email of the signed-in author. Byline ORCID iDs are typed in by
 * submitters and never verified, and an OJS account link alone proves
 * nothing new, so a record counts as "mine" only when its email is the one
 * ORCID verified at sign-in (identity.email_hash). Candidates come from the
 * linked OJS account and from bylines carrying the signed-in ORCID iD.
 * Read-only OJS queries.
 */
export async function resolveSelfEmail(identity: {
  orcid: string
  ojs_user_id: number | null
  email_hash: string | null
}): Promise<SelfEmailResult> {
  if (!identity.email_hash) {
    return {
      ok: false,
      status: 404,
      error:
        "ORCID did not share a verified email address with us, so we cannot match you to your articles. Make your email visible to trusted parties in ORCID and sign in again, or contact the editorial office.",
    }
  }
  try {
    const candidates: string[] = []
    if (identity.ojs_user_id) {
      const rows = await ojsQuery<{ email: string }>("SELECT email FROM users WHERE user_id = ?", [identity.ojs_user_id])
      candidates.push(...rows.map((r) => r.email))
    }
    const rows = await ojsQuery<{ email: string }>(
      `SELECT DISTINCT LOWER(a.email) AS email
         FROM authors a
         JOIN author_settings s ON s.author_id = a.author_id AND s.setting_name = 'orcid'
        WHERE UPPER(SUBSTRING_INDEX(TRIM(s.setting_value), '/', -1)) = ? AND a.email IS NOT NULL AND a.email <> ''`,
      [identity.orcid.toUpperCase()]
    )
    candidates.push(...rows.map((r) => r.email))
    const mine = candidates.find((email) => emailHash(email) === identity.email_hash)
    if (mine) return { ok: true, email: mine.trim().toLowerCase() }
    return {
      ok: false,
      status: 404,
      error:
        "We found no OJS account or article under the email ORCID verified for you. Contact the editorial office to link your record.",
    }
  } catch (e) {
    console.error("[author-profile] resolving the signed-in author failed:", e instanceof Error ? e.message : e)
    return { ok: false, status: 503, error: messageForCode("unavailable") }
  }
}
