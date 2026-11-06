/**
 * #273 — the home page "Researchers" figure (/api/statistics totalUsers) must
 * use the same definition as the admin dashboard's "Total Authors": distinct
 * author emails across the surfaced journals, not the OJS login-account count.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/src/features/ojs/server/ojs-client", () => ({
  isOjsConfigured: vi.fn(() => true),
  ojsQuery: vi.fn(async (sql: string) => {
    if (/FROM users\b/i.test(sql) && !/country/i.test(sql)) return [{ count: 45 }]
    if (/country/i.test(sql)) return [{ count: 22 }]
    return [{ count: 112 }]
  }),
}))

vi.mock("@/src/features/ojs/server/ojs-stats-service", () => ({
  getOjsPlatformStats: vi.fn(async () => ({ totalAuthors: 207 })),
}))

vi.mock("@/src/lib/db/config", () => ({
  prisma: { journal: { count: vi.fn(async () => 14) } },
}))

describe("GET /statistics", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("reports researchers as the dashboard's distinct-author count", async () => {
    const { statisticsRouter } = await import("@/src/features/statistics/server/route")
    const res = await statisticsRouter.request("/")
    const body = await res.json()
    expect(body.success).toBe(true)
    expect(body.data).toEqual({ totalJournals: 14, totalArticles: 112, totalUsers: 207, countriesCount: 22 })
  })
})
