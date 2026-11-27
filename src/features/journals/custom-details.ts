import { z } from "zod"

/**
 * #281: manager-defined fields shown after the built-in fields (ISSN, Publisher,
 * Frequency) in the public "Journal Details" card. #288: values are rich text.
 * Stored in `journals.custom_details` as an ordered JSON array; the OJS sync never writes it.
 *
 * Rows are `{label, html}`. `html` is sanitized on the server on write and on read
 * (`server/custom-details-html.ts`); nothing in this client-safe module sanitizes.
 * Legacy #281 rows `{label, value}` hold plain text and are converted on read.
 */
export interface CustomDetail {
  label: string
  html: string
}

export const MAX_CUSTOM_DETAILS = 20
export const CUSTOM_DETAIL_LABEL_MAX = 80
/**
 * #290: values have no editorial length limit. This raw-HTML ceiling (roughly
 * 15-20 pages of text) only stops an accidental huge paste from bloating the
 * row and every load of the journal page.
 */
export const CUSTOM_DETAIL_HTML_MAX = 100_000

/**
 * Counts the characters a reader sees: tags removed, each entity counted once,
 * surrounding whitespace ignored. Used to detect empty values, never for safety.
 */
export function htmlTextLength(html: string): number {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, "x")
    .trim().length
}

const draftRowSchema = z.object({
  label: z.string().trim().max(CUSTOM_DETAIL_LABEL_MAX, `Labels are at most ${CUSTOM_DETAIL_LABEL_MAX} characters`),
  html: z.string().trim().max(CUSTOM_DETAIL_HTML_MAX, "This value is too long"),
})

const savedRowSchema = z.object({
  label: z.string().min(1, "Each field needs a label"),
  html: z.string().refine((html) => htmlTextLength(html) > 0, "Each field needs a value"),
})

/**
 * Validates the list an admin saves. Rows left completely empty (no label, and an
 * empty editor such as "<p></p>") are dropped; half-filled rows are rejected.
 * The raw cap bounds the payload before the empty-row filter runs.
 */
export const customDetailsSchema = z
  .array(draftRowSchema)
  .max(MAX_CUSTOM_DETAILS * 5)
  .transform((rows) => rows.filter((row) => row.label !== "" || htmlTextLength(row.html) > 0))
  .pipe(z.array(savedRowSchema).max(MAX_CUSTOM_DETAILS, `At most ${MAX_CUSTOM_DETAILS} custom fields`))

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

/**
 * Converts a legacy #281 plain-text value to HTML: escaped, line breaks kept, and
 * a whole-value http(s) URL linked (the #281 behaviour).
 */
export function plainTextToHtml(value: string): string {
  const v = value.trim()
  const href = toSafeHref(v)
  if (href) {
    return `<p><a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(v)}</a></p>`
  }
  return `<p>${escapeHtml(v).replace(/\r?\n/g, "<br>")}</p>`
}

/**
 * Reads the stored JSON defensively: never throws, drops malformed or empty
 * entries, keeps order, converts legacy rows. Does NOT sanitize: server callers
 * pass the result through `sanitizeCustomDetails`.
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
    const { label, html, value } = entry as Record<string, unknown>
    if (typeof label !== "string") continue
    const l = label.trim()
    let h: string | null = null
    if (typeof html === "string") h = html.trim()
    else if (typeof value === "string" && value.trim()) h = plainTextToHtml(value)
    if (l && h && htmlTextLength(h) > 0) out.push({ label: l, html: h })
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
