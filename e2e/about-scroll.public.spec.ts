import { test, expect } from "@playwright/test"

/**
 * About-journal scroll stability (#275, regression of #150). The scroll-spy
 * keeps the URL on the visible section (/about-journal/{slug}). Doing that
 * with a router navigation remounted the view and threw the page up by
 * ~1000px at the Editorial Board. Scrolling must never move the page by
 * itself or rebuild the sections.
 *
 * Needs journal data: skips on CI's empty DB. Run against a site with data
 * via `E2E_BASE_URL=<url> E2E_JOURNAL=ojbr bunx playwright test --project=public about-scroll`.
 */
test("about-journal page scrolls without jumps or remounts", async ({ page }) => {
    test.setTimeout(120_000)
    let journal = process.env.E2E_JOURNAL ? `/journals/${process.env.E2E_JOURNAL}` : null
    if (!journal) {
        await page.goto("/journals", { waitUntil: "domcontentloaded" })
        await page.locator('a[href^="/journals/"]').first().waitFor({ timeout: 15_000 }).catch(() => {})
        const hrefs = await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))
        journal = hrefs.find((h) => /^\/journals\/[^/?#]+$/.test(h)) ?? null
    }
    test.skip(!journal, "no journals in this environment")

    await page.goto(journal!, { waitUntil: "domcontentloaded" })
    await expect(page.locator("#about-editorial-board")).toBeAttached({ timeout: 30_000 })
    // Let the client-loaded boards settle before measuring.
    await page.waitForTimeout(2_000)

    const result = await page.evaluate(async () => {
        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
        const marker = document.getElementById("about-editorial-board") as (HTMLElement & { __e2e?: boolean }) | null
        if (marker) marker.__e2e = true
        const jumps: string[] = []
        let remounts = 0
        let y = window.scrollY
        for (let step = 0; step < 200; step++) {
            const max = document.documentElement.scrollHeight - window.innerHeight
            if (y >= max - 2) break
            const target = Math.min(y + 60, max)
            window.scrollTo({ top: target, behavior: "instant" })
            await sleep(150)
            const now = window.scrollY
            if (Math.abs(now - target) > 5) jumps.push(`wanted ${Math.round(target)} got ${Math.round(now)} at ${location.pathname}`)
            const el = document.getElementById("about-editorial-board") as (HTMLElement & { __e2e?: boolean }) | null
            if (el && !el.__e2e) {
                remounts++
                el.__e2e = true
            }
            y = now
        }
        await sleep(1_000)
        return { jumps, remounts, path: location.pathname }
    })

    expect(result.jumps, "page moved by itself while scrolling").toEqual([])
    expect(result.remounts, "about sections were rebuilt while scrolling").toBe(0)
    // The URL still follows the visible section (which one is last depends
    // on the journal's content and the viewport).
    expect(result.path).toMatch(/\/about-journal\/[a-z-]+$/)
})
