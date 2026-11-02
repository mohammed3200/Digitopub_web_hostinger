import { z } from "zod"
import sanitizeHtml from "sanitize-html"
import { ojsJournalSchema } from "../schemas/ojs-schema"
import type { OjsJournal } from "../schemas/ojs-schema"
import { parseOjsFilename, buildOjsPublicUrl } from "@/src/features/ojs/utils/ojs-asset-url"
import { getOjsPublicAssetsBaseUrl, normalizeOjsAssetUrl } from "@/src/features/ojs/utils/ojs-config"

/** Raw row shape from the OJS MySQL database */
export const ojsJournalRowSchema = z.object({
    journal_id: z.number(),
    path: z.string(),
    primary_locale: z.string(),
    enabled: z.number(),           // DB stores as 0/1
    name: z.string().nullable(),
    description: z.string().nullable(),
    thumbnail: z.string().nullable(),
    issn: z.string().nullable().optional(),
    e_issn: z.string().nullable().optional(),
    publisher: z.string().nullable().optional(),
    abbreviation: z.string().nullable().optional(),
    contact_name: z.string().nullable().optional(),
    country: z.string().nullable().optional(),
    aims_and_scope: z.string().nullable().optional(),
    author_guidelines: z.string().nullable().optional(),
    publication_fee: z.string().nullable().optional(),
    submission_fee: z.string().nullable().optional(),
    publication_fee_description: z.string().nullable().optional(),
    currency_code: z.string().nullable().optional(),
})

export type OjsJournalRow = z.infer<typeof ojsJournalRowSchema>

/** Maps a raw DB row to the application domain model */
export function mapOjsJournalRow(row: OjsJournalRow, baseUrl: string): OjsJournal {
    const cleanDescription = row.description
        ? sanitizeHtml(row.description, { allowedTags: [], allowedAttributes: {} }).trim()
        : null;

    const imageFilename = parseOjsFilename(row.thumbnail)
    // Trailing slashes are stripped first, or "https://host/ojs/" keeps its /ojs (#260).
    const effectiveBaseUrl = (baseUrl ? baseUrl.replace(/\/+$/, "").replace(/\/ojs$/i, "") : "") || getOjsPublicAssetsBaseUrl()
    const rawThumbnailUrl = imageFilename
        ? buildOjsPublicUrl(effectiveBaseUrl, `public/journals/${row.journal_id}`, imageFilename)
        : null
    const thumbnailUrl = normalizeOjsAssetUrl(rawThumbnailUrl)

    return ojsJournalSchema.parse({
        journal_id: row.journal_id,
        path: row.path,
        primary_locale: row.primary_locale,
        enabled: row.enabled === 1,   // int → boolean
        name: row.name,
        description: cleanDescription || null,
        thumbnail_url: thumbnailUrl,
        issn: row.issn || null,
        e_issn: row.e_issn || null,
        publisher: row.publisher || null,
        abbreviation: row.abbreviation || null,
        contact_name: row.contact_name || null,
        country: row.country || null,
        // Sanitize OJS HTML content — keep basic block elements, strip scripts/styles
        aims_and_scope: row.aims_and_scope
            ? sanitizeHtml(row.aims_and_scope, {
                allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h3', 'h4'],
                allowedAttributes: {},
              }).trim() || null
            : null,
        author_guidelines: row.author_guidelines
            ? sanitizeHtml(row.author_guidelines, {
                allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h3', 'h4'],
                allowedAttributes: {},
              }).trim() || null
            : null,
        publication_fee: parseFee(row.publication_fee),
        submission_fee: parseFee(row.submission_fee),
        publication_fee_description: row.publication_fee_description
            ? sanitizeHtml(row.publication_fee_description, {
                allowedTags: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h3', 'h4', 'a'],
                allowedAttributes: { a: ['href', 'target', 'rel'] },
              }).trim() || null
            : null,
        currency_code: row.currency_code ? row.currency_code.toUpperCase() : null,
    })
}

function parseFee(value: string | null | undefined): number | null {
    if (value == null) return null
    const n = parseFloat(String(value).replace(/[^0-9.\-]/g, ""))
    return Number.isFinite(n) && n >= 0 ? n : null
}
