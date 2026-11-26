import { describe, it, expect } from 'vitest'
import { sanitizeCustomDetailHtml, sanitizeCustomDetails } from '@/src/features/journals/server/custom-details-html'

const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer"'

// #288: the only gate between admin-written HTML and the public Journal Details card.
describe('custom detail HTML sanitizer (#288)', () => {
    describe('keeps the allowed formatting', () => {
        it.each([
            '<p>plain</p>',
            '<p>one<br />two</p>',
            '<p><strong>bold</strong> and <em>italic</em></p>',
            '<h4>Publisher</h4><p>Statement.</p>',
            '<ul><li>a</li><li>b</li></ul>',
            '<ol><li>first</li></ol>',
        ])('%s', (html) => {
            expect(sanitizeCustomDetailHtml(html)).toBe(html)
        })

        it('keeps http, https and mailto links and forces target/rel', () => {
            expect(sanitizeCustomDetailHtml('<p><a href="https://example.org/guide">Author Guidelines</a></p>'))
                .toBe(`<p><a href="https://example.org/guide" ${LINK_ATTRS}>Author Guidelines</a></p>`)
            expect(sanitizeCustomDetailHtml('<a href="http://example.org" target="_self" rel="opener">x</a>'))
                .toBe(`<a href="http://example.org" ${LINK_ATTRS}>x</a>`)
            expect(sanitizeCustomDetailHtml('<a href="mailto:office@example.org">office@example.org</a>'))
                .toBe(`<a href="mailto:office@example.org" ${LINK_ATTRS}>office@example.org</a>`)
        })
    })

    describe('strips anything dangerous', () => {
        it.each([
            ['<script>alert(1)</script><p>ok</p>', '<p>ok</p>'],
            ['<p onclick="alert(1)">ok</p>', '<p>ok</p>'],
            ['<img src="x" onerror="alert(1)"><p>ok</p>', '<p>ok</p>'],
            ['<iframe src="https://evil.example"></iframe><p>ok</p>', '<p>ok</p>'],
            ['<style>p{display:none}</style><p>ok</p>', '<p>ok</p>'],
            ['<p style="color:red" class="x">ok</p>', '<p>ok</p>'],
            ['<svg><script>alert(1)</script></svg><p>ok</p>', '<p>ok</p>'],
        ])('%s', (input, expected) => {
            expect(sanitizeCustomDetailHtml(input)).toBe(expected)
        })

        it.each([
            'javascript:alert(1)',
            'JaVaScRiPt:alert(1)',
            ' javascript:alert(1)',
            'data:text/html,<script>alert(1)</script>',
            'vbscript:msgbox(1)',
            '//evil.example/path',
            '/relative/path',
        ])('unlinks href=%p but keeps the text', (href) => {
            expect(sanitizeCustomDetailHtml(`<p><a href="${href}">click</a></p>`)).toBe('<p>click</p>')
        })

        it('closes a safe link correctly when an unsafe link precedes it at the same depth', () => {
            expect(sanitizeCustomDetailHtml('<p><a href="javascript:x">bad</a> <a href="mailto:o@example.org">mail</a></p>'))
                .toBe(`<p>bad <a href="mailto:o@example.org" ${LINK_ATTRS}>mail</a></p>`)
        })

        it('unlinks an anchor with no href', () => {
            expect(sanitizeCustomDetailHtml('<p><a name="x">text</a></p>')).toBe('<p>text</p>')
        })
    })

    describe('normalizes pasted Word / browser markup', () => {
        it.each([
            ['<b>bold</b>', '<strong>bold</strong>'],
            ['<i>it</i>', '<em>it</em>'],
            ['<h1>T</h1>', '<h4>T</h4>'],
            ['<h2>T</h2>', '<h4>T</h4>'],
            ['<h3>T</h3>', '<h4>T</h4>'],
            ['<h6>T</h6>', '<h4>T</h4>'],
            ['<div>block</div>', '<p>block</p>'],
            ['<p><span style="font-family:Calibri" lang="en-US">text</span></p>', '<p>text</p>'],
            ['<p class="MsoNormal">text<o:p></o:p></p>', '<p>text</p>'],
            ['<table><tr><td>cell</td></tr></table>', 'cell'],
        ])('%s', (input, expected) => {
            expect(sanitizeCustomDetailHtml(input)).toBe(expected)
        })
    })

    describe('sanitizeCustomDetails', () => {
        it('sanitizes every row and keeps order', () => {
            expect(sanitizeCustomDetails([
                { label: 'A', html: '<p onclick="x">1</p>' },
                { label: 'B', html: '<b>2</b>' },
            ])).toEqual([
                { label: 'A', html: '<p>1</p>' },
                { label: 'B', html: '<strong>2</strong>' },
            ])
        })

        it('drops rows that are empty after sanitizing', () => {
            expect(sanitizeCustomDetails([
                { label: 'A', html: '<img src=x onerror=alert(1)>' },
                { label: 'B', html: '<p>kept</p>' },
            ])).toEqual([{ label: 'B', html: '<p>kept</p>' }])
        })
    })
})
