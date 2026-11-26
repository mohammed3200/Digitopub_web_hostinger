import sanitizeHtml from "sanitize-html"
import { htmlTextLength, type CustomDetail } from "../custom-details"

/**
 * #288: the only gate between admin-written HTML and the public "Journal Details"
 * card, which renders it with dangerouslySetInnerHTML. Runs on write (PATCH) and
 * on every read, so a row written any other way is still cleaned before display.
 * Server only: keeps sanitize-html out of client bundles.
 */

/** A link survives only with an absolute http(s) or mailto target. */
const SAFE_HREF = /^(https?:\/\/|mailto:)/i

const OPTIONS: NonNullable<Parameters<typeof sanitizeHtml>[1]> = {
  allowedTags: ["p", "br", "strong", "em", "h4", "ul", "ol", "li", "a"],
  allowedAttributes: { a: ["href", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    // Pasted Word / browser markup, mapped onto the small allowed set.
    b: "strong",
    i: "em",
    h1: "h4",
    h2: "h4",
    h3: "h4",
    h5: "h4",
    h6: "h4",
    div: "p",
    a: (tagName: string, attribs: Record<string, string>) => {
      const href = (attribs.href ?? "").trim()
      // An unsafe or missing target loses every attribute and is unwrapped below.
      // (Renaming it to a disallowed tag instead makes sanitize-html 2.18 close the
      // next link at the same depth with the wrong tag.)
      if (!SAFE_HREF.test(href)) return { tagName, attribs: {} }
      return { tagName, attribs: { href, target: "_blank", rel: "noopener noreferrer" } }
    },
  },
}

/** An attribute-less <a> with no anchors inside: what an unsafe link becomes. */
const BARE_ANCHOR = /<a>((?:(?!<\/?a[\s>])[\s\S])*?)<\/a>/g

export function sanitizeCustomDetailHtml(html: string): string {
  return sanitizeHtml(html, OPTIONS).replace(BARE_ANCHOR, "$1").trim()
}

/** Sanitizes every row, keeps order, and drops rows with no visible text left. */
export function sanitizeCustomDetails(rows: CustomDetail[]): CustomDetail[] {
  return rows
    .map((row) => ({ label: row.label, html: sanitizeCustomDetailHtml(row.html) }))
    .filter((row) => htmlTextLength(row.html) > 0)
}
