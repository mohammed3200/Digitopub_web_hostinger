import { test, expect, type Page } from "@playwright/test"

/**
 * Phone-width layout guard (#269). The page shell hides horizontal overflow
 * (`main { overflow-x: clip }`, `body { overflow-x: hidden }`), so anything
 * wider than the viewport is silently cut off rather than scrollable. These
 * checks catch that: no page content may extend past the viewport.
 *
 * Journal pages come from OJS data, which CI's empty DB lacks — the journal
 * checks skip there. Run against a site with data via
 * `E2E_BASE_URL=<preview> bunx playwright test --project=public-mobile`.
 */

async function overflowingElements(page: Page): Promise<string[]> {
    return page.evaluate(() => {
        const limit = window.innerWidth + 1
        // Content inside a horizontal scroller that fits the viewport (tab
        // bars, pill rows) is reachable, and carousels hide off-screen slides
        // on purpose. Anything else past the edge is clipped by the page-level
        // overflow on <main>/<body> (or an overflow-hidden card) and lost.
        const insideFittingScroller = (el: Element) => {
            if (el.closest('[aria-roledescription="carousel"]')) return true
            for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
                const cs = getComputedStyle(a)
                // Fixed layers (off-canvas menus, toasts) are not page content.
                if (cs.position === "fixed") return true
                const ox = cs.overflowX
                if ((ox === "auto" || ox === "scroll") && a.getBoundingClientRect().right <= limit) {
                    return true
                }
            }
            return false
        }
        // Whole body: the issue and article pages have no <main>.
        const wide = [...document.querySelectorAll("body *")].filter((el) => {
            const r = el.getBoundingClientRect()
            return (
                r.width > 0 &&
                r.right > limit &&
                getComputedStyle(el).position !== "fixed" &&
                !insideFittingScroller(el)
            )
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

async function expectFitsViewport(page: Page, path: string, readySelector?: string) {
    // "load" can stall on slow third-party resources, so wait for the real
    // content instead: these pages first stream a loading skeleton (its own
    // <main>, no <h1>), and measuring that would hide the bug.
    const response = await page.goto(path, { waitUntil: "domcontentloaded" })
    expect(response?.status(), path).toBeLessThan(400)
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 20_000 })
    if (readySelector) {
        // Optional: an empty journal legitimately has no such element.
        await page.locator(readySelector).first().waitFor({ timeout: 15_000 }).catch(() => {})
    }
    expect(await overflowingElements(page), `overflow on ${path}`).toEqual([])
}

async function firstHref(page: Page, pattern: RegExp): Promise<string | null> {
    const hrefs = await page
        .locator("a[href]")
        .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""))
    return hrefs.find((h) => pattern.test(h)) ?? null
}

/**
 * The journal to test. E2E_JOURNAL (an OJS path, e.g. "ojbr") pins one that
 * has published issues, and then the issue and article checks are required.
 */
async function firstJournal(page: Page): Promise<string | null> {
    if (process.env.E2E_JOURNAL) return `/journals/${process.env.E2E_JOURNAL}`
    await page.goto("/journals", { waitUntil: "domcontentloaded" })
    // The listing renders client-side; give it a moment before deciding
    // this environment has no journals.
    await page
        .locator('a[href^="/journals/"]')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => {})
    return firstHref(page, /^\/journals\/[^/?#]+$/)
}

test.describe("phone layout", () => {
    test("journals listing fits the viewport", async ({ page }) => {
        await expectFitsViewport(page, "/journals")
    })

    test("journal detail, issue and article pages fit the viewport", async ({ page }) => {
        test.setTimeout(180_000)
        const pinned = process.env.E2E_JOURNAL
        const journal = await firstJournal(page)
        test.skip(!journal, "no journals in this environment")

        for (const path of [journal!, `${journal}/author-guidelines`, `${journal}/policies`]) {
            await expectFitsViewport(page, path)
            const tablist = page.locator("[role=tablist]").first()
            const width = await tablist.evaluate((el) => el.clientWidth)
            expect(width, `tablist width on ${path}`).toBeLessThanOrEqual(page.viewportSize()!.width)
        }

        // Current Issue and Archive fetch their lists client-side: wait for the
        // first article / issue link so the check measures the real list, not
        // the loading skeleton. A journal with no issues yet is reported, not
        // silently skipped.
        await expectFitsViewport(page, `${journal}/current-issue`, 'a[href*="/articles/"]')
        const article = await firstHref(page, /\/articles\/\d+$/)

        await expectFitsViewport(page, `${journal}/archive`, 'a[href*="/issues/"]')
        const issue = await firstHref(page, /\/issues\/\d+\/\d+$/)

        test.info().annotations.push({ type: "pages", description: `issue=${issue ?? "none"} article=${article ?? "none"}` })
        if (pinned) {
            expect(issue, `no issue link on ${journal}/archive`).not.toBeNull()
            expect(article, `no article link on ${journal}/current-issue`).not.toBeNull()
        }
        if (issue) await expectFitsViewport(page, issue)
        if (article) await expectFitsViewport(page, article)
    })

    test("journal tab bar is on the first screen and shows the active tab (#270)", async ({ page }) => {
        test.setTimeout(90_000)
        const journal = await firstJournal(page)
        test.skip(!journal, "no journals in this environment")

        await page.goto(journal!, { waitUntil: "domcontentloaded" })
        const tablist = page.locator("[role=tablist]").first()
        await expect(tablist).toBeVisible({ timeout: 30_000 })
        const top = await tablist.evaluate((el) => el.getBoundingClientRect().top + window.scrollY)
        expect(top, "tab bar top (px) at 375x812").toBeLessThanOrEqual(600)

        // Policies is the last tab, off-screen at 375px unless the strip scrolls to it.
        await page.goto(`${journal}/policies`, { waitUntil: "domcontentloaded" })
        await expect(tablist).toBeVisible({ timeout: 30_000 })
        const active = tablist.locator('[role=tab][data-state="active"]')
        await expect(active).toHaveText(/Policies/)
        await expect
            .poll(() =>
                active.evaluate((tab) => {
                    const t = tab.getBoundingClientRect()
                    const l = tab.parentElement!.getBoundingClientRect()
                    return t.left >= l.left - 1 && t.right <= l.right + 1
                }),
            )
            .toBe(true)
    })
})
