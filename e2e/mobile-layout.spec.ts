import { test, expect, type Page } from "@playwright/test"

/**
 * Phone-width layout guard (#269). The page shell hides horizontal overflow
 * (`main { overflow-x: clip }`, `body { overflow-x: hidden }`), so anything
 * wider than the viewport is silently cut off rather than scrollable. These
 * checks catch that: nothing inside <main> may extend past the viewport.
 *
 * Journal pages come from OJS data, which CI's empty DB lacks — the journal
 * checks skip there. Run against a site with data via
 * `E2E_BASE_URL=<preview> bunx playwright test --project=public-mobile`.
 */

async function overflowingElements(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const limit = window.innerWidth + 1
        // Content inside a container that fits the viewport and scrolls or
        // clips on purpose (tab bars, pill rows, carousels) is fine. Only the
        // page-level clip on <main>/<body> loses content.
        const insideFittingScroller = (el: Element) => {
            for (let a = el.parentElement; a && a.tagName !== "MAIN"; a = a.parentElement) {
                if (getComputedStyle(a).overflowX !== "visible" && a.getBoundingClientRect().right <= limit) {
                    return true
                }
            }
            return false
        }
        const wide = [...document.querySelectorAll("main *")].filter((el) => {
            const r = el.getBoundingClientRect()
            return r.width > 0 && r.right > limit && !insideFittingScroller(el)
        })
        // Report only the outermost offenders, not every descendant.
        return wide
            .filter((el) => !wide.includes(el.parentElement as Element))
            .slice(0, 5)
            .map(
                (el) =>
                    `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} right=${Math.round(el.getBoundingClientRect().right)}`,
            )
    })
}

async function expectFitsViewport(page: Page, path: string) {
    // "load" can stall on slow third-party resources, so wait for the real
    // content instead: these pages first stream a loading skeleton (its own
    // <main>, no <h1>), and measuring that would hide the bug.
    const response = await page.goto(path, { waitUntil: "domcontentloaded" })
    expect(response?.status(), path).toBeLessThan(400)
    await expect(page.locator("main h1").first()).toBeVisible({ timeout: 20_000 })
    expect(await overflowingElements(page), `overflow on ${path}`).toEqual([])
}

async function firstHref(page: Page, pattern: RegExp): Promise<string | null> {
    const hrefs = await page
        .locator("a[href]")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))
    return hrefs.find((h) => pattern.test(h)) ?? null
}

test.describe("phone layout", () => {
    test("journals listing fits the viewport", async ({ page }) => {
        await expectFitsViewport(page, "/journals")
    })

    test("journal detail, issue and article pages fit the viewport", async ({ page }) => {
        test.setTimeout(180_000)
        await page.goto("/journals", { waitUntil: "domcontentloaded" })
        // The listing renders client-side; give it a moment before deciding
        // this environment has no journals.
        await page
            .locator('a[href^="/journals/"]')
            .first()
            .waitFor({ timeout: 15_000 })
            .catch(() => {})
        const journal = await firstHref(page, /^\/journals\/[^/?#]+$/)
        test.skip(!journal, "no journals in this environment")

        for (const path of [journal!, `${journal}/author-guidelines`, `${journal}/archive`, `${journal}/policies`]) {
            await expectFitsViewport(page, path)
            const tablist = page.locator("[role=tablist]").first()
            const width = await tablist.evaluate((el) => el.clientWidth)
            expect(width, `tablist width on ${path}`).toBeLessThanOrEqual(page.viewportSize()!.width)
        }

        await expectFitsViewport(page, `${journal}/current-issue`)
        const article = await firstHref(page, /\/articles\/\d+$/)

        await page.goto(`${journal}/archive`, { waitUntil: "domcontentloaded" })
        const issue = await firstHref(page, /\/issues\/\d+\/\d+$/)
        if (issue) await expectFitsViewport(page, issue)
        if (article) await expectFitsViewport(page, article)
    })
})
