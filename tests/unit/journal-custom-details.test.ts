import { describe, it, expect } from 'vitest'
import {
    customDetailsSchema,
    parseCustomDetails,
    plainTextToHtml,
    htmlTextLength,
    toSafeHref,
    MAX_CUSTOM_DETAILS,
    CUSTOM_DETAIL_HTML_MAX,
} from '@/src/features/journals/custom-details'
import { journalCreateSchema, journalUpdateSchema } from '@/src/features/journals/schemas/journal-schema'

// #281: manager-defined label/value pairs shown in the public Journal Details card.
// #288: values are rich text, stored as sanitized HTML in `html`.
describe('journal custom details (#281, #288)', () => {
    describe('customDetailsSchema', () => {
        it('trims labels and html and keeps order', () => {
            expect(customDetailsSchema.parse([
                { label: '  Indexed in ', html: ' <p>Scopus</p> ' },
                { label: 'Language', html: '<p>English</p>' },
            ])).toEqual([
                { label: 'Indexed in', html: '<p>Scopus</p>' },
                { label: 'Language', html: '<p>English</p>' },
            ])
        })

        it('drops rows the manager left completely empty, including an empty editor', () => {
            expect(customDetailsSchema.parse([
                { label: ' ', html: '' },
                { label: '', html: '<p></p>' },
                { label: 'Language', html: '<p>English</p>' },
            ])).toEqual([{ label: 'Language', html: '<p>English</p>' }])
        })

        it('accepts an empty list (clears all fields)', () => {
            expect(customDetailsSchema.parse([])).toEqual([])
        })

        it('rejects a blank label with a value, and a label with a blank value', () => {
            expect(customDetailsSchema.safeParse([{ label: '  ', html: '<p>x</p>' }]).success).toBe(false)
            expect(customDetailsSchema.safeParse([{ label: 'x', html: '  ' }]).success).toBe(false)
            expect(customDetailsSchema.safeParse([{ label: 'x', html: '<p> </p><p></p>' }]).success).toBe(false)
        })

        it('limits labels to 80 characters', () => {
            expect(customDetailsSchema.safeParse([{ label: 'a'.repeat(81), html: '<p>x</p>' }]).success).toBe(false)
            expect(customDetailsSchema.safeParse([{ label: 'a'.repeat(80), html: '<p>x</p>' }]).success).toBe(true)
        })

        // #290: no practical limit on value length.
        it('accepts long values (no visible-text limit)', () => {
            const long = `<p>${'a'.repeat(5000)}</p><ul>${'<li>item</li>'.repeat(200)}</ul>`
            expect(customDetailsSchema.safeParse([{ label: 'x', html: long }]).success).toBe(true)
        })

        it(`keeps a hidden safety ceiling of ${CUSTOM_DETAIL_HTML_MAX} html characters`, () => {
            const atCap = `<p>${'a'.repeat(CUSTOM_DETAIL_HTML_MAX - 7)}</p>`
            expect(atCap).toHaveLength(CUSTOM_DETAIL_HTML_MAX)
            expect(customDetailsSchema.safeParse([{ label: 'x', html: atCap }]).success).toBe(true)
            expect(customDetailsSchema.safeParse([{ label: 'x', html: `${atCap} ` + 'a' }]).success).toBe(false)
        })

        it(`rejects more than ${MAX_CUSTOM_DETAILS} fields`, () => {
            const row = { label: 'L', html: '<p>V</p>' }
            expect(customDetailsSchema.safeParse(Array(MAX_CUSTOM_DETAILS).fill(row)).success).toBe(true)
            expect(customDetailsSchema.safeParse(Array(MAX_CUSTOM_DETAILS + 1).fill(row)).success).toBe(false)
        })

        it('rejects the old {label, value} shape on save', () => {
            expect(customDetailsSchema.safeParse([{ label: 'A', value: 'B' }]).success).toBe(false)
        })
    })

    describe('journal schemas', () => {
        it('accepts custom_details on update', () => {
            expect(journalUpdateSchema.parse({ custom_details: [{ label: 'A', html: '<p>B</p>' }] }))
                .toEqual({ custom_details: [{ label: 'A', html: '<p>B</p>' }] })
        })

        it('leaves custom_details out of a partial update that does not send it', () => {
            expect(journalUpdateSchema.parse({ title: 'T' })).toEqual({ title: 'T' })
        })

        it('strips custom_details on create', () => {
            const result = journalCreateSchema.parse({ title: 'T', field: 'CS', custom_details: [{ label: 'A', html: '<p>B</p>' }] })
            expect(result).not.toHaveProperty('custom_details')
        })
    })

    describe('htmlTextLength', () => {
        it.each([
            ['', 0],
            ['<p></p>', 0],
            ['<p> </p>', 0],
            ['<p>abc</p>', 3],
            ['<p>a<br>b</p>', 2],
            ['<p>a &amp; b</p>', 5],
            ['<p>&lt;tag&gt;</p>', 5],
            ['<h4>Head</h4><ul><li>one</li></ul>', 7],
        ])('%p has %i visible characters', (html, n) => {
            expect(htmlTextLength(html)).toBe(n)
        })
    })

    describe('plainTextToHtml (legacy #281 values)', () => {
        it('escapes markup characters so legacy text never becomes HTML', () => {
            expect(plainTextToHtml('a < b & "c" <script>')).toBe('<p>a &lt; b &amp; &quot;c&quot; &lt;script&gt;</p>')
        })

        it('keeps line breaks', () => {
            expect(plainTextToHtml('line one\nline two\r\nline three')).toBe('<p>line one<br>line two<br>line three</p>')
        })

        it('links a whole-value http(s) URL, as #281 did', () => {
            expect(plainTextToHtml(' https://doaj.org/toc/1234-5678 ')).toBe(
                '<p><a href="https://doaj.org/toc/1234-5678" target="_blank" rel="noopener noreferrer">https://doaj.org/toc/1234-5678</a></p>',
            )
        })

        it('does not link other schemes', () => {
            expect(plainTextToHtml('javascript:alert(1)')).toBe('<p>javascript:alert(1)</p>')
        })
    })

    describe('parseCustomDetails', () => {
        it.each([null, undefined, 'text', 42, {}, { label: 'A', html: '<p>B</p>' }])('returns [] for %p', (raw) => {
            expect(parseCustomDetails(raw)).toEqual([])
        })

        it('reads a JSON string (MariaDB stores JSON as LONGTEXT)', () => {
            expect(parseCustomDetails('[{"label":"Language","html":"<p>English</p>"}]'))
                .toEqual([{ label: 'Language', html: '<p>English</p>' }])
            expect(parseCustomDetails('{not json')).toEqual([])
        })

        it('converts legacy {label, value} rows to escaped html', () => {
            expect(parseCustomDetails([{ label: 'Note', value: 'a < b\nc' }]))
                .toEqual([{ label: 'Note', html: '<p>a &lt; b<br>c</p>' }])
        })

        it('prefers html when a row has both', () => {
            expect(parseCustomDetails([{ label: 'A', html: '<p>new</p>', value: 'old' }]))
                .toEqual([{ label: 'A', html: '<p>new</p>' }])
        })

        it('keeps valid entries in order and drops malformed or empty ones', () => {
            expect(parseCustomDetails([
                { label: 'A', html: '<p>1</p>' },
                null,
                { label: 'B' },
                { label: 3, html: 'x' },
                { label: '  ', html: '<p>x</p>' },
                { label: 'E', html: '<p></p>' },
                { label: 'C', value: '2', extra: true },
            ])).toEqual([
                { label: 'A', html: '<p>1</p>' },
                { label: 'C', html: '<p>2</p>' },
            ])
        })

        it(`returns at most ${MAX_CUSTOM_DETAILS} entries`, () => {
            expect(parseCustomDetails(Array(MAX_CUSTOM_DETAILS + 5).fill({ label: 'L', html: '<p>V</p>' })))
                .toHaveLength(MAX_CUSTOM_DETAILS)
        })
    })

    describe('toSafeHref', () => {
        it.each([
            ['https://www.scopus.com/sourceid/123', 'https://www.scopus.com/sourceid/123'],
            ['http://example.org', 'http://example.org/'],
            ['  https://doaj.org/toc/1234-5678  ', 'https://doaj.org/toc/1234-5678'],
        ])('links %s', (value, href) => {
            expect(toSafeHref(value)).toBe(href)
        })

        it.each([
            'javascript:alert(1)',
            'JAVASCRIPT:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'mailto:editor@example.org',
            'Scopus, Web of Science',
            '2432-3993',
            'https://',
            'see https://example.org',
            '',
        ])('does not link %p', (value) => {
            expect(toSafeHref(value)).toBeNull()
        })
    })
})
