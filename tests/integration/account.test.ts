import { describe, it, expect, beforeEach, vi } from "vitest"

const hoisted = vi.hoisted(() => ({
    userMetricsFindUnique: vi.fn(),
    userEventDeleteMany: vi.fn(),
    userMetricsDeleteMany: vi.fn(),
    userOrcidLinkDeleteMany: vi.fn(),
    notificationSubscriberDeleteMany: vi.fn(),
    personEmailChangeDeleteMany: vi.fn(),
    revokedOrcidUpsert: vi.fn(),
    revokedOrcidFindUnique: vi.fn(async () => null),
    transaction: vi.fn(),
    queryRawUnsafe: vi.fn(),
}))

vi.mock("@/src/lib/db/config", () => ({
    prisma: {
        userMetrics: {
            findUnique: hoisted.userMetricsFindUnique,
            deleteMany: hoisted.userMetricsDeleteMany,
        },
        userEvent: {
            deleteMany: hoisted.userEventDeleteMany,
        },
        userOrcidLink: {
            deleteMany: hoisted.userOrcidLinkDeleteMany,
        },
        revokedOrcid: {
            upsert: hoisted.revokedOrcidUpsert,
            findUnique: hoisted.revokedOrcidFindUnique,
        },
        $transaction: hoisted.transaction,
        $queryRawUnsafe: hoisted.queryRawUnsafe,
    },
}))

// account.ts reaches the email service through the notifications feature.
vi.mock("server-only", () => ({}))
vi.mock("@/src/lib/email/service", () => ({ sendTemplateEmail: vi.fn(async () => ({ success: true })) }))

process.env.IDENTITY_COOKIE_SECRET ||= "test-secret"
process.env.ORCID_STATE_SECRET ||= "test-secret"
process.env.EVENT_IP_HASH_SALT_SEED ||= "test-secret"
process.env.ORCID_CLIENT_ID ||= "test-orcid-client"
process.env.ORCID_CLIENT_SECRET ||= "test-secret"

import { Hono } from "hono"
import { accountRouter } from "@/src/server/routes/account"
import {
    IDENTITY_COOKIE_NAME,
    mintCookie,
    __resetRevocationCacheForTests,
} from "@/src/lib/identity-cookie"

const app = new Hono().route("/", accountRouter)
const ORCID = "0000-0001-2345-6789"

function authedRequest(path: string, init: RequestInit = {}, emailHash: string | null = null) {
    const cookie = mintCookie({ orcid: ORCID, ojs_user_id: null, email_hash: emailHash })
    return app.request(`http://test${path}`, {
        ...init,
        headers: {
            ...(init.headers || {}),
            cookie: `${IDENTITY_COOKIE_NAME}=${encodeURIComponent(cookie)}`,
        },
    })
}

describe("/api/account", () => {
    beforeEach(() => {
        __resetRevocationCacheForTests()
        Object.values(hoisted).forEach((fn) => {
            if (typeof fn === "function" && "mockReset" in fn) {
                ;(fn as ReturnType<typeof vi.fn>).mockReset()
            }
        })
        hoisted.revokedOrcidFindUnique.mockResolvedValue(null)
        hoisted.queryRawUnsafe.mockResolvedValue([])
        hoisted.userMetricsFindUnique.mockResolvedValue(null)
    })

    describe("GET /stats", () => {
        it("returns 401 when no identity cookie", async () => {
            const res = await app.request("http://test/stats")
            expect(res.status).toBe(401)
        })

        it("returns lifetime + monthly when authenticated", async () => {
            hoisted.userMetricsFindUnique.mockResolvedValue({
                orcid: ORCID,
                views: 5,
                downloads: 3,
                citations: 1,
                first_seen_at: new Date("2026-01-01"),
                last_event_at: new Date("2026-05-01"),
            })
            hoisted.queryRawUnsafe.mockResolvedValue([
                { ym: "2026-05", views: 5n, downloads: 3n, citations: 1n },
            ])
            const res = await authedRequest("/stats")
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body.success).toBe(true)
            expect(body.data.orcid).toBe(ORCID)
            expect(body.data.lifetime.views).toBe(5)
            expect(body.data.monthly).toHaveLength(12)
            const may = body.data.monthly.find(
                (m: { year: number; month: number }) => m.year === 2026 && m.month === 5
            )
            expect(may.views).toBe(5)
        })
    })

    describe("DELETE /data", () => {
        it("returns 401 when anonymous", async () => {
            const res = await app.request("http://test/data", { method: "DELETE" })
            expect(res.status).toBe(401)
        })

        it("erases data, sets revoked_orcids, clears cookie", async () => {
            hoisted.transaction.mockImplementation(
                async (cb: (tx: typeof import("@/src/lib/db/config").prisma) => unknown) => {
                    hoisted.userEventDeleteMany.mockResolvedValue({ count: 7 })
                    hoisted.userMetricsDeleteMany.mockResolvedValue({ count: 1 })
                    hoisted.userOrcidLinkDeleteMany.mockResolvedValue({ count: 1 })
                    hoisted.notificationSubscriberDeleteMany.mockResolvedValue({ count: 1 })
                    hoisted.personEmailChangeDeleteMany.mockResolvedValue({ count: 2 })
                    hoisted.revokedOrcidUpsert.mockResolvedValue({
                        orcid: ORCID,
                        revoked_at: new Date(),
                        cookie_iat_min: Math.floor(Date.now() / 1000),
                    })
                    return cb({
                        userEvent: { deleteMany: hoisted.userEventDeleteMany },
                        userMetrics: { deleteMany: hoisted.userMetricsDeleteMany },
                        userOrcidLink: { deleteMany: hoisted.userOrcidLinkDeleteMany },
                        notificationSubscriber: { deleteMany: hoisted.notificationSubscriberDeleteMany },
                        personEmailChange: { deleteMany: hoisted.personEmailChangeDeleteMany },
                        revokedOrcid: { upsert: hoisted.revokedOrcidUpsert },
                    } as never)
                }
            )

            const EMAIL_HASH = "a".repeat(64)
            const res = await authedRequest("/data", { method: "DELETE" }, EMAIL_HASH)
            expect(res.status).toBe(200)
            const body = await res.json()
            expect(body.success).toBe(true)
            expect(body.deleted.user_event_rows).toBe(7)
            // Publication-alert subscriber erased by ORCID iD or verified email (#199).
            expect(body.deleted.notification_subscriber_rows).toBe(1)
            expect(hoisted.notificationSubscriberDeleteMany).toHaveBeenCalledWith({
                where: { OR: [{ orcid: ORCID }, { email_hash: EMAIL_HASH }] },
            })
            // Pending author email changes this ORCID iD asked for (#233).
            expect(body.deleted.person_email_change_rows).toBe(2)
            expect(hoisted.personEmailChangeDeleteMany).toHaveBeenCalledWith({ where: { requested_by_orcid: ORCID } })
            const setCookie = res.headers.get("Set-Cookie") || ""
            expect(setCookie).toContain(`${IDENTITY_COOKIE_NAME}=`)
            expect(setCookie).toContain("Max-Age=0")
            expect(hoisted.revokedOrcidUpsert).toHaveBeenCalledOnce()
        })
    })
})
