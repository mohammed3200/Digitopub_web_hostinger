import { describe, it, expect } from 'vitest'
import {
    customDetailsSchema,
    parseCustomDetails,
    toSafeHref,
    MAX_CUSTOM_DETAILS,
} from '@/src/features/journals/custom-details'
import { journalCreateSchema, journalUpdateSchema } from '@/src/features/journals/schemas/journal-schema'

// #281: manager-defined label/value pairs shown in the public Journal Details card.
describe('journal custom details (#281)', () => {
    describe('customDetailsSchema', () => {
        it('trims labels and values and keeps order', () => {
            expect(customDetailsSchema.parse([
                { label: '  Indexed in ', value: ' Scopus ' },
                { label: 'Language', value: 'English' },
            ])).toEqual([
                { label: 'Indexed in', value: 'Scopus' },
                { label: 'Language', value: 'English' },
            ])
        })

        it('drops rows the manager left completely empty', () => {
            expect(customDetailsSchema.parse([
                { label: ' ', value: '' },
                { label: 'Language', value: 'English' },
            ])).toEqual([{ label: 'Language', value: 'English' }])
        })

        it('accepts an empty list (clears all fields)', () => {
            expect(customDetailsSchema.parse([])).toEqual([])
        })

        it('rejects a blank label with a value, and a label with a blank value', () => {
            expect(customDetailsSchema.safeParse([{ label: '  ', value: 'x' }]).success).toBe(false)
            expect(customDetailsSchema.safeParse([{ label: 'x', value: '  ' }]).success).toBe(false)
        })

        it('enforces length limits', () => {
            expect(customDetailsSchema.safeParse([{ label: 'a'.repeat(81), value: 'x' }]).success).toBe(false)
            expect(customDetailsSchema.safeParse([{ label: 'x', value: 'a'.repeat(501) }]).success).toBe(false)
            expect(customDetailsSchema.safeParse([{ label: 'a'.repeat(80), value: 'a'.repeat(500) }]).success).toBe(true)
        })

        it(`rejects more than ${MAX_CUSTOM_DETAILS} fields`, () => {
            const row = { label: 'L', value: 'V' }
            expect(customDetailsSchema.safeParse(Array(MAX_CUSTOM_DETAILS).fill(row)).success).toBe(true)
            expect(customDetailsSchema.safeParse(Array(MAX_CUSTOM_DETAILS + 1).fill(row)).success).toBe(false)
        })
    })

    describe('journal schemas', () => {
        it('accepts custom_details on update', () => {
            expect(journalUpdateSchema.parse({ custom_details: [{ label: 'A', value: 'B' }] }))
                .toEqual({ custom_details: [{ label: 'A', value: 'B' }] })
        })

        it('leaves custom_details out of a partial update that does not send it', () => {
            expect(journalUpdateSchema.parse({ title: 'T' })).toEqual({ title: 'T' })
        })

        it('strips custom_details on create', () => {
            const result = journalCreateSchema.parse({ title: 'T', field: 'CS', custom_details: [{ label: 'A', value: 'B' }] })
            expect(result).not.toHaveProperty('custom_details')
        })
    })

    describe('parseCustomDetails', () => {
        it.each([null, undefined, 'text', 42, {}, { label: 'A', value: 'B' }])('returns [] for %p', (raw) => {
            expect(parseCustomDetails(raw)).toEqual([])
        })

        it('reads a JSON string (MariaDB stores JSON as LONGTEXT)', () => {
            expect(parseCustomDetails('[{"label":"Language","value":"English"}]'))
                .toEqual([{ label: 'Language', value: 'English' }])
            expect(parseCustomDetails('{not json')).toEqual([])
        })

        it('keeps valid entries in order and drops malformed ones', () => {
            expect(parseCustomDetails([
                { label: 'A', value: '1' },
                null,
                { label: 'B' },
                { label: 3, value: 'x' },
                { label: '  ', value: 'x' },
                { label: 'C', value: '2', extra: true },
            ])).toEqual([
                { label: 'A', value: '1' },
                { label: 'C', value: '2' },
            ])
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
