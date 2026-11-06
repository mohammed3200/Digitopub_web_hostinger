import { Hono } from "hono"
import { ojsQuery, isOjsConfigured } from "@/src/features/ojs/server/ojs-client"
import { getOjsPlatformStats } from "@/src/features/ojs/server/ojs-stats-service"
import { prisma } from "@/src/lib/db/config"

interface StatsData {
  totalJournals: number
  totalArticles: number
  totalUsers: number
  countriesCount: number
}

// Simple in-memory cache
let statsCache: StatsData | null = null
let lastFetchTime = 0
const CACHE_TTL_MS = 60 * 60 * 1000 // 1 hour

const app = new Hono()

app.get("/", async (c) => {
  try {
    if (!isOjsConfigured()) {
      return c.json({ success: false, error: "OJS database not configured" }, 503)
    }

    const now = Date.now()
    if (statsCache && (now - lastFetchTime) < CACHE_TTL_MS) {
      return c.json({ success: true, data: statsCache })
    }

    // Count journals from Prisma — single source of truth for what is actually
    // displayed on DigitoPub. OJS's `enabled` flag only hides a journal from
    // its own storefront; DigitoPub continues to surface every synced journal,
    // so filtering by `enabled = 1` here would undercount.
    const queries = [
      prisma.journal.count(),
      ojsQuery<{ count: number }>("SELECT COUNT(*) as count FROM submissions WHERE status = 3"),
      // Researchers: distinct author emails across the surfaced journals, the
      // same figure as the admin dashboard's "Total Authors" (#273). The OJS
      // `users` table only holds login accounts, which most co-authors lack.
      getOjsPlatformStats(),
      ojsQuery<{ count: number }>("SELECT COUNT(DISTINCT country) as count FROM users WHERE country IS NOT NULL AND country != ''")
    ] as const;

    const results = await Promise.allSettled(queries);

    // Only cache if all queries succeeded; transient failures (network, DB
    // downtime) should not be cached as zeros, and we want to retry on next request.
    const allFulfilled = results.every((r) => r.status === "fulfilled")
    if (!allFulfilled) {
      console.warn("[STATISTICS_GET] Some queries failed; not caching results")
    }

    interface CountRow { count: number }
    const extractOjsCount = (result: PromiseSettledResult<CountRow[]>) =>
      result.status === "fulfilled" ? (result.value[0]?.count || 0) : 0;
    const extractNumber = (result: PromiseSettledResult<number>) =>
      result.status === "fulfilled" ? (result.value || 0) : 0;

    const journalsData = extractNumber(results[0] as PromiseSettledResult<number>);
    const articlesData = extractOjsCount(results[1] as PromiseSettledResult<CountRow[]>);
    const platformStats = results[2] as PromiseSettledResult<{ totalAuthors: number }>
    const usersData = platformStats.status === "fulfilled" ? platformStats.value.totalAuthors || 0 : 0;
    const countriesData = extractOjsCount(results[3] as PromiseSettledResult<CountRow[]>);

    const data: StatsData = {
      totalJournals: journalsData,
      totalArticles: articlesData,
      totalUsers: usersData,
      countriesCount: countriesData,
    }

    // Only persist to cache if all queries succeeded.
    if (allFulfilled) {
      statsCache = data
      lastFetchTime = now
    }

    return c.json({ success: true, data })
  } catch (error) {
    console.error("[STATISTICS_GET_ERROR]", error)
    const errorMessage = error instanceof Error ? error.message : "Failed to fetch statistics"
    return c.json({ success: false, error: errorMessage }, 500)
  }
})

export { app as statisticsRouter }
