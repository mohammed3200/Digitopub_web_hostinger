import { describe, it, expect, vi, afterEach } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"

// next/script needs the Next runtime; a stub is enough for markup.
vi.mock("next/script", () => ({ default: () => null }))
vi.mock("@/src/features/metrics/api/use-citation-counts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/features/metrics/api/use-citation-counts")>()),
  useCitationCount: () => ({ data: { count: 3, source: "crossref", fetched_at: null }, isLoading: false }),
}))

/** DIMENSIONS_BADGES_ENABLED is read at import time, so import afresh per mode. */
async function render(enabled: boolean, props: { doi: string | null; size?: "sm" | "md" }) {
  vi.stubEnv("NEXT_PUBLIC_DIMENSIONS_BADGES", enabled ? "true" : "")
  vi.resetModules()
  const { CitationBadge, DIMENSIONS_BADGES_ENABLED } = await import("@/components/citation-badge")
  return { html: renderToStaticMarkup(createElement(CitationBadge, props)), enabled: DIMENSIONS_BADGES_ENABLED }
}

afterEach(() => vi.unstubAllEnvs())

describe("CitationBadge with Dimensions (#258)", () => {
  it("renders the official Dimensions embed when switched on", async () => {
    const { html, enabled } = await render(true, { doi: "https://doi.org/10.26629/IJMP.2017.02", size: "md" })
    expect(enabled).toBe(true)
    expect(html).toContain('class="__dimensions_badge_embed__')
    expect(html).toContain('data-doi="10.26629/ijmp.2017.02"')
    expect(html).toContain('data-style="medium_circle"')
    // Legend side left to Dimensions (every fixed side clipped on a phone).
    expect(html).not.toContain("data-legend")
  })

  it("uses the small circle on cards", async () => {
    const { html } = await render(true, { doi: "10.26629/ijmp.2017.02", size: "sm" })
    expect(html).toContain('data-style="small_circle"')
  })

  it("renders nothing without a DigitoPub DOI", async () => {
    expect((await render(true, { doi: null })).html).toBe("")
    expect((await render(true, { doi: "10.1001/jama.2016.9797" })).html).toBe("")
  })

  it("keeps the hexagon badge when switched off", async () => {
    const { html, enabled } = await render(false, { doi: "10.26629/ijmp.2017.02", size: "md" })
    expect(enabled).toBe(false)
    expect(html).not.toContain("__dimensions_badge_embed__")
    expect(html).toContain("3 citations (source: Crossref)")
  })
})
