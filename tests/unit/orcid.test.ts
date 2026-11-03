import { describe, expect, it } from "vitest"
import { normalizeOrcidId, orcidProfileUrl } from "@/src/lib/orcid"

describe("normalizeOrcidId (#263)", () => {
  it.each([
    ["0000-0002-1825-0097", "0000-0002-1825-0097"],
    ["https://orcid.org/0000-0002-1825-0097", "0000-0002-1825-0097"],
    ["http://orcid.org/0000-0002-1825-0097/", "0000-0002-1825-0097"],
    ["  https://orcid.org/0000-0001-5109-370x ", "0000-0001-5109-370X"],
    ["orcid.org/0000-0001-5109-3700", "0000-0001-5109-3700"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeOrcidId(input)).toBe(expected)
  })

  it.each([null, undefined, "", "   ", "0000-0002-1825", "https://orcid.org/", "0000-0002-1825-009Y", "https://example.com/0000-0002-1825-0097"])(
    "rejects %s",
    (input) => {
      expect(normalizeOrcidId(input)).toBeNull()
    },
  )
})

describe("orcidProfileUrl", () => {
  it("builds the canonical https URL", () => {
    expect(orcidProfileUrl("0000-0002-1825-0097")).toBe("https://orcid.org/0000-0002-1825-0097")
  })
})
