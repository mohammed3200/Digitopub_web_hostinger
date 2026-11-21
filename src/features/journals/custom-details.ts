import { z } from "zod"

/**
 * #281: manager-defined label/value pairs shown after the built-in fields
 * (ISSN, Publisher, Frequency) in the public "Journal Details" card.
 * Stored in `journals.custom_details` as an ordered JSON array; the OJS sync never writes it.
 */
export interface CustomDetail {
  label: string
  value: string
}

export const MAX_CUSTOM_DETAILS = 20
export const CUSTOM_DETAIL_LABEL_MAX = 80
export const CUSTOM_DETAIL_VALUE_MAX = 500

const draftRowSchema = z.object({
  label: z.string().trim().max(CUSTOM_DETAIL_LABEL_MAX, `Labels are at most ${CUSTOM_DETAIL_LABEL_MAX} characters`),
  value: z.string().trim().max(CUSTOM_DETAIL_VALUE_MAX, `Values are at most ${CUSTOM_DETAIL_VALUE_MAX} characters`),
})

const savedRowSchema = z.object({
  label: z.string().min(1, "Each field needs a label"),
  value: z.string().min(1, "Each field needs a value"),
})

/**
 * Validates the list an admin saves. Rows left completely empty are dropped
 * (an unused "Add field" row is not an error); half-filled rows are rejected.
 * The raw cap bounds the payload before the empty-row filter runs.
 */
export const customDetailsSchema = z
  .array(draftRowSchema)
  .max(MAX_CUSTOM_DETAILS * 5)
  .transform((rows) => rows.filter((row) => row.label !== "" || row.value !== ""))
  .pipe(z.array(savedRowSchema).max(MAX_CUSTOM_DETAILS, `At most ${MAX_CUSTOM_DETAILS} custom fields`))

/**
 * Reads the stored JSON defensively for display: never throws, drops malformed
 * entries, keeps order. The column is admin-written, but a bad row must not
 * break the public journal page.
 */
export function parseCustomDetails(raw: unknown): CustomDetail[] {
  // Production is MariaDB, where JSON is LONGTEXT; tolerate a driver returning the raw text.
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw)
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []
  const out: CustomDetail[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue
    const { label, value } = entry as Record<string, unknown>
    if (typeof label !== "string" || typeof value !== "string") continue
    const l = label.trim()
    const v = value.trim()
    if (l && v) out.push({ label: l, value: v })
  }
  return out.slice(0, MAX_CUSTOM_DETAILS)
}

/**
 * Returns a link target when the whole value is an http(s) URL, otherwise null
 * (the value is shown as plain text). This is the only gate between an
 * admin-typed string and an <a href> on the public page.
 */
export function toSafeHref(value: string): string | null {
  const v = value.trim()
  // Whole value only: "see https://…" stays text. No bare "www." guessing.
  if (!/^https?:\/\/\S+$/i.test(v)) return null
  try {
    const url = new URL(v)
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? url.href : null
  } catch {
    return null
  }
}
