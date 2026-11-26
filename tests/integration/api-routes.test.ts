import { describe, it, expect, vi, beforeEach } from 'vitest'
import { journalRouter } from '@/src/features/journals/server/route'
import { messageRouter } from '@/src/features/messages/server'
import { solutionRouter } from '@/src/features/solutions/server/route'
import { prisma } from '@/src/lib/db/config'
import { Hono } from 'hono'

// ════════════════════════════════════════
// Mock all external dependencies BEFORE importing routes
// ════════════════════════════════════════

// Mock session state
let mockSession: any = null

vi.mock('@/src/lib/db/auth', () => ({
    getSession: vi.fn(() => mockSession),
    createSession: vi.fn(),
    destroySession: vi.fn(),
}))

vi.mock('@/src/lib/db/config', () => ({
    prisma: {
        $queryRaw: vi.fn(),
        $transaction: (fn: (tx: never) => unknown) => fn({
            $queryRaw: prisma.$queryRaw,
            journal: { create: prisma.journal.create },
        } as never),
        // #234: journal create validates `field` against the managed list.
        journalSpecialization: {
            findFirst: vi.fn().mockResolvedValue({ id: BigInt(1), name: 'CS', is_active: true }),
        },
        journal: {
            findMany: vi.fn().mockResolvedValue([]),
            findUnique: vi.fn().mockResolvedValue(null),
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            count: vi.fn().mockResolvedValue(0),
        },
        message: {
            findMany: vi.fn().mockResolvedValue([]),
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            count: vi.fn().mockResolvedValue(0),
        },
        fAQ: {
            findMany: vi.fn().mockResolvedValue([]),
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            count: vi.fn().mockResolvedValue(0),
        },
        solution: {
            findMany: vi.fn().mockResolvedValue([]),
            findUnique: vi.fn().mockResolvedValue(null),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
            count: vi.fn().mockResolvedValue(0),
        },
    },
}))

// Helper to create Hono test app
function createApp() {
    const app = new Hono().basePath("/api")
    app.route('/journals', journalRouter)
    app.route('/messages', messageRouter)
    app.route('/solutions', solutionRouter)
    return app
}

describe('API Integration Tests', () => {
    let app: ReturnType<typeof createApp>

    beforeEach(() => {
        vi.resetAllMocks()
        mockSession = null
        app = createApp()
    })

    // ═══════════════════════════════════════
    // JOURNALS
    // ═══════════════════════════════════════
    describe('Journals API', () => {
        describe('GET /journals', () => {
            it('should return paginated journals (public)', async () => {
                const mockJournals = [
                    { id: BigInt(1), title: 'Test Journal', field: 'CS', status: 'active', created_at: new Date() },
                ]
                vi.mocked(prisma.journal.findMany).mockResolvedValue(mockJournals as any)
                vi.mocked(prisma.journal.count).mockResolvedValue(1)

                const res = await app.request('/api/journals')
                expect(res.status).toBe(200)

                const body = await res.json()
                expect(body.success).toBe(true)
                expect(body.data).toBeDefined()
                expect(body.pagination).toBeDefined()
                expect(body.pagination.total).toBe(1)
            })

            it('should respect pagination parameters', async () => {
                vi.mocked(prisma.journal.findMany).mockResolvedValue([])
                vi.mocked(prisma.journal.count).mockResolvedValue(0)

                await app.request('/api/journals?page=2&limit=5')

                expect(prisma.journal.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        take: 5,
                        skip: 5,
                    })
                )
            })
        })

        describe('GET /journals/:id', () => {
            it('should return 404 for non-existent journal', async () => {
                vi.mocked(prisma.journal.findFirst).mockResolvedValue(null)
                vi.mocked(prisma.journal.findUnique).mockResolvedValue(null)

                const res = await app.request('/api/journals/999')
                expect(res.status).toBe(404)
            })

            it('should return journal by ID', async () => {
                const mockJournal = {
                    id: BigInt(1), title: 'Test', field: 'CS', status: 'active',
                    created_at: new Date(), updated_at: new Date(), created_by: BigInt(1),
                }
                // findFirst (ojs_path lookup) returns null, findUnique (ojs_id) returns null,
                // findUnique (BigInt id) returns the journal
                vi.mocked(prisma.journal.findFirst).mockResolvedValue(null)
                vi.mocked(prisma.journal.findUnique)
                    .mockResolvedValueOnce(null) // ojs_id lookup
                    .mockResolvedValueOnce(mockJournal as any) // BigInt id lookup

                const res = await app.request('/api/journals/1')
                expect(res.status).toBe(200)

                const body = await res.json()
                expect(body.success).toBe(true)
                expect(body.data.id).toBe('1')
            })

            // #231: the invitation text is admin-only; the unselected record must not leak it.
            it('does not expose invitation_scope publicly', async () => {
                const mockJournal = {
                    id: BigInt(1), title: 'Test', field: 'CS', status: 'active',
                    created_at: new Date(), updated_at: new Date(), created_by: BigInt(1),
                    invitation_scope: 'an international journal dedicated to testing',
                }
                vi.mocked(prisma.journal.findFirst).mockResolvedValue(null)
                vi.mocked(prisma.journal.findUnique)
                    .mockResolvedValueOnce(null)
                    .mockResolvedValueOnce(mockJournal as any)

                const res = await app.request('/api/journals/1')
                expect(res.status).toBe(200)
                const body = await res.json()
                expect(body.data.title).toBe('Test')
                expect(body.data).not.toHaveProperty('invitation_scope')
            })

            // #288: custom detail values are rendered as HTML, so the public read sanitizes them.
            it('returns sanitized custom_details and converts legacy plain-text rows', async () => {
                const mockJournal = {
                    id: BigInt(1), title: 'Test', field: 'CS', status: 'active',
                    created_at: new Date(), updated_at: new Date(), created_by: BigInt(1),
                    custom_details: JSON.stringify([
                        { label: 'Office', html: '<p onclick="x">Editor<img src=x onerror=alert(1)></p><script>alert(1)</script>' },
                        { label: 'Legacy', value: 'a < b' },
                        { label: 'Gone', html: '<p><script>alert(1)</script></p>' },
                    ]),
                }
                vi.mocked(prisma.journal.findFirst).mockResolvedValue(null)
                vi.mocked(prisma.journal.findUnique)
                    .mockResolvedValueOnce(null)
                    .mockResolvedValueOnce(mockJournal as any)

                const res = await app.request('/api/journals/1')
                expect(res.status).toBe(200)
                expect((await res.json()).data.custom_details).toEqual([
                    { label: 'Office', html: '<p>Editor</p>' },
                    { label: 'Legacy', html: '<p>a &lt; b</p>' },
                ])
            })

            it('should accept slug-based identifiers (any string)', async () => {
                // Slug-based routing: the API now accepts any string (ojs_path, ojs_id, or numeric id)
                vi.mocked(prisma.journal.findFirst).mockResolvedValue(null)
                vi.mocked(prisma.journal.findUnique).mockResolvedValue(null)

                const res = await app.request('/api/journals/my-journal-slug')
                // Should return 404, not 400 — meaning the slug was accepted and looked up
                expect(res.status).toBe(404)
            })
        })

        describe('POST /journals', () => {
            it('should reject unauthenticated requests', async () => {
                mockSession = null

                const res = await app.request('/api/journals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: 'New Journal', field: 'CS' }),
                })
                expect(res.status).toBe(401)
            })

            it('should reject non-admin users', async () => {
                mockSession = { id: '1', email: 'author@test.com', role: 'author' }

                const res = await app.request('/api/journals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: 'New Journal', field: 'CS' }),
                })
                expect(res.status).toBe(403)
            })

            it('should create journal for admin users', async () => {
                mockSession = { id: '1', email: 'admin@test.com', role: 'admin', full_name: 'Admin' }
                const mockJournal = {
                    id: BigInt(1), title: 'New Journal', field: 'CS',
                    status: 'active', created_at: new Date(), created_by: BigInt(1),
                }
                vi.mocked(prisma.journal.create).mockResolvedValue(mockJournal as any)
                vi.mocked(prisma.journalSpecialization.findFirst).mockResolvedValue({ id: BigInt(1), name: 'CS', is_active: true } as any)
                vi.mocked(prisma.$queryRaw).mockResolvedValue([{ name: 'CS' }] as never)

                const res = await app.request('/api/journals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: 'New Journal', field: 'CS' }),
                })
                expect(res.status).toBe(201)

                const body = await res.json()
                expect(body.success).toBe(true)
                expect(prisma.$queryRaw.mock.calls[0][0].join(' ')).toContain('FOR UPDATE')
            })

            it('should reject invalid data', async () => {
                mockSession = { id: '1', email: 'admin@test.com', role: 'admin' }

                const res = await app.request('/api/journals', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ title: '' }),
                })
                expect(res.status).toBe(400)
            })
        })

        describe('DELETE /journals/:id', () => {
            it('should reject unauthenticated delete', async () => {
                mockSession = null

                const res = await app.request('/api/journals/1', { method: 'DELETE' })
                expect(res.status).toBe(401)
            })

            it('should reject non-admin delete', async () => {
                mockSession = { id: '1', email: 'author@test.com', role: 'author' }

                const res = await app.request('/api/journals/1', { method: 'DELETE' })
                expect(res.status).toBe(403)
            })

            it('should return 404 for non-existent journal', async () => {
                mockSession = { id: '1', email: 'admin@test.com', role: 'admin' }
                vi.mocked(prisma.journal.findUnique).mockResolvedValue(null)

                const res = await app.request('/api/journals/999', { method: 'DELETE' })
                expect(res.status).toBe(404)
            })

            it('should delete existing journal as admin', async () => {
                mockSession = { id: '1', email: 'admin@test.com', role: 'admin' }
                vi.mocked(prisma.journal.findUnique).mockResolvedValue({ id: BigInt(1) } as any)
                vi.mocked(prisma.journal.delete).mockResolvedValue({} as any)

                const res = await app.request('/api/journals/1', { method: 'DELETE' })
                expect(res.status).toBe(200)
            })
        })

        // #281: manager-defined custom fields for the Journal Details card. #288: values are sanitized HTML.
        describe('PATCH /journals/:id custom_details', () => {
            const patch = (body: unknown) => app.request('/api/journals/1', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const details = [
                { label: 'Indexed in', html: '<p>Scopus</p>' },
                { label: 'Website', html: '<p><a href="https://example.org" target="_blank" rel="noopener noreferrer">Example</a></p>' },
            ]
            const asAdmin = () => {
                mockSession = { id: '1', email: 'admin@test.com', role: 'admin' }
                vi.mocked(prisma.journal.findUnique).mockResolvedValue({ id: BigInt(1) } as any)
            }

            it('rejects unauthenticated updates', async () => {
                const res = await patch({ custom_details: details })
                expect(res.status).toBe(401)
                expect(prisma.journal.update).not.toHaveBeenCalled()
            })

            it('rejects non-admin roles', async () => {
                mockSession = { id: '1', email: 'editor@test.com', role: 'editor' }
                const res = await patch({ custom_details: details })
                expect(res.status).toBe(403)
                expect(prisma.journal.update).not.toHaveBeenCalled()
            })

            it('saves the ordered list as admin', async () => {
                asAdmin()
                vi.mocked(prisma.journal.update).mockResolvedValue({ id: BigInt(1), custom_details: details } as any)

                const res = await patch({ custom_details: [{ label: ' Indexed in ', html: '<p>Scopus</p> ' }, details[1]] })
                expect(res.status).toBe(200)
                expect(prisma.journal.update).toHaveBeenCalledWith(expect.objectContaining({
                    where: { id: BigInt(1) },
                    data: { custom_details: details },
                }))
                expect((await res.json()).data.custom_details).toEqual(details)
            })

            it('stores sanitized HTML only', async () => {
                asAdmin()
                vi.mocked(prisma.journal.update).mockResolvedValue({ id: BigInt(1) } as any)

                const res = await patch({ custom_details: [{
                    label: 'Office',
                    html: '<p style="color:red" onclick="x"><b>Editor</b><img src=x onerror=alert(1)></p>'
                        + '<p><a href="javascript:alert(1)">bad</a> <a href="mailto:office@example.org">mail</a></p>',
                }] })
                expect(res.status).toBe(200)
                expect(prisma.journal.update).toHaveBeenCalledWith(expect.objectContaining({
                    data: { custom_details: [{
                        label: 'Office',
                        html: '<p><strong>Editor</strong></p>'
                            + '<p>bad <a href="mailto:office@example.org" target="_blank" rel="noopener noreferrer">mail</a></p>',
                    }] },
                }))
            })

            it('rejects a value with no text left after sanitizing, without writing', async () => {
                asAdmin()
                // Passes the schema (the script body counts as text) but is empty once cleaned.
                const res = await patch({ custom_details: [
                    { label: 'Kept', html: '<p>ok</p>' },
                    { label: 'Empty', html: '<p><script>alert(1)</script></p>' },
                ] })
                expect(res.status).toBe(400)
                expect(prisma.journal.update).not.toHaveBeenCalled()
            })

            it.each([
                ['more than 20 fields', Array(21).fill({ label: 'L', html: '<p>V</p>' })],
                ['visible text over 500 characters', [{ label: 'L', html: `<p>${'a'.repeat(501)}</p>` }]],
                ['raw html over 4000 characters', [{ label: 'L', html: '<p><strong>a</strong></p>'.repeat(170) }]],
                ['the legacy {label, value} shape', [{ label: 'L', value: 'V' }]],
            ])('rejects %s without writing', async (_name, body) => {
                asAdmin()
                const res = await patch({ custom_details: body })
                expect(res.status).toBe(400)
                expect(prisma.journal.update).not.toHaveBeenCalled()
            })
        })
    })

    // ═══════════════════════════════════════
    // MESSAGES
    // ═══════════════════════════════════════
    describe('Messages API', () => {
        describe('GET /messages', () => {
            it('should reject unauthenticated requests', async () => {
                mockSession = null
                const res = await app.request('/api/messages')
                expect(res.status).toBe(401)
            })

            it('should reject non-admin users', async () => {
                mockSession = { id: '1', email: 'author@test.com', role: 'author' }
                const res = await app.request('/api/messages')
                expect(res.status).toBe(403)
            })

            it('should return messages for admin', async () => {
                mockSession = { id: '1', email: 'admin@test.com', role: 'admin' }
                vi.mocked(prisma.message.findMany).mockResolvedValue([])
                vi.mocked(prisma.message.count).mockResolvedValue(0)

                const res = await app.request('/api/messages')
                expect(res.status).toBe(200)

                const body = await res.json()
                expect(body.success).toBe(true)
                expect(body.pagination).toBeDefined()
            })
        })

        describe('POST /messages', () => {
            it('should allow public message submission', async () => {
                const mockMessage = {
                    id: BigInt(1), name: 'Test', email: 'test@test.com',
                    subject: 'Hello', message: 'World', message_type: 'general',
                    status: 'unread', created_at: new Date(),
                }
                vi.mocked(prisma.message.create).mockResolvedValue(mockMessage as any)

                const res = await app.request('/api/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: 'Test User',
                        email: 'test@example.com',
                        subject: 'Test Subject',
                        message: 'Test message content',
                    }),
                })
                expect(res.status).toBe(201)
            })

            it('should reject invalid email in message', async () => {
                const res = await app.request('/api/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        name: 'Test',
                        email: 'invalid',
                        subject: 'Test',
                        message: 'Content',
                    }),
                })
                expect(res.status).toBe(400)
            })

            it('should reject missing required fields', async () => {
                const res = await app.request('/api/messages', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: 'Test' }),
                })
                expect(res.status).toBe(400)
            })
        })

        describe('DELETE /messages/:id', () => {
            it('should reject non-admin delete', async () => {
                mockSession = { id: '1', email: 'author@test.com', role: 'author' }
                const res = await app.request('/api/messages/1', { method: 'DELETE' })
                expect(res.status).toBe(403)
            })
        })
    })

    // ═══════════════════════════════════════
    // SOLUTIONS
    // ═══════════════════════════════════════
    describe('Solutions API', () => {
        describe('GET /solutions', () => {
            it('should return only published solutions for unauthenticated users', async () => {
                mockSession = null
                vi.mocked(prisma.solution.findMany).mockResolvedValue([])
                vi.mocked(prisma.solution.count).mockResolvedValue(0)

                const res = await app.request('/api/solutions')
                expect(res.status).toBe(200)

                // Check that findMany was called with is_published filter
                expect(prisma.solution.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: { is_published: true },
                    })
                )
            })

            it('should return all solutions for admin', async () => {
                mockSession = { id: '1', email: 'admin@test.com', role: 'admin' }
                vi.mocked(prisma.solution.findMany).mockResolvedValue([])
                vi.mocked(prisma.solution.count).mockResolvedValue(0)

                await app.request('/api/solutions')

                expect(prisma.solution.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        where: {},
                    })
                )
            })
        })

        describe('POST /solutions', () => {
            it('should reject unauthenticated creation', async () => {
                mockSession = null

                const res = await app.request('/api/solutions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: 'Digital Publishing',
                        description: 'Modern solutions.',
                    }),
                })
                expect(res.status).toBe(401)
            })

            it('should reject non-admin creation', async () => {
                mockSession = { id: '1', email: 'author@test.com', role: 'author' }

                const res = await app.request('/api/solutions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: 'Digital Publishing',
                        description: 'Modern solutions.',
                    }),
                })
                expect(res.status).toBe(403)
            })

            it('should create solution as admin', async () => {
                mockSession = { id: '1', email: 'admin@test.com', role: 'admin' }
                const mockSolution = {
                    id: BigInt(1), title: 'Digital Publishing', description: 'Solutions.',
                    icon: 'Globe', features: [], is_published: false,
                    display_order: 1, created_at: new Date(), updated_at: new Date(),
                }
                vi.mocked(prisma.solution.create).mockResolvedValue(mockSolution as any)

                const res = await app.request('/api/solutions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: 'Digital Publishing',
                        description: 'Modern solutions.',
                        icon: 'Globe',
                        features: ['A', 'B']
                    }),
                })
                expect(res.status).toBe(201)
                expect(prisma.solution.create).toHaveBeenCalledWith({
                    data: {
                        title: 'Digital Publishing',
                        description: 'Modern solutions.',
                        icon: 'Globe',
                        features: ['A', 'B'],
                        display_order: 0,
                        is_published: false
                    },
                    select: {
                        id: true,
                        title: true,
                        description: true,
                        icon: true,
                        features: true,
                        display_order: true,
                        is_published: true,
                        created_at: true,
                        updated_at: true
                    }
                })
            })
        })

        describe('DELETE /solutions/:id', () => {
            it('should reject non-admin delete', async () => {
                mockSession = { id: '1', email: 'author@test.com', role: 'author' }
                const res = await app.request('/api/solutions/1', { method: 'DELETE' })
                expect(res.status).toBe(403)
            })

            it('should delete as admin', async () => {
                mockSession = { id: '1', email: 'admin@test.com', role: 'admin' }
                vi.mocked(prisma.solution.findUnique).mockResolvedValue({ id: BigInt(1) } as any)
                vi.mocked(prisma.solution.delete).mockResolvedValue({} as any)

                const res = await app.request('/api/solutions/1', { method: 'DELETE' })
                expect(res.status).toBe(200)
            })
        })
    })
})
