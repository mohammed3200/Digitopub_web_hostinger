import { describe, expect, it, vi } from "vitest"
import {
  CANONICAL_OJS_HOST,
  OJS_ALIAS_HOSTS,
  DEAD_EXTERNAL_HOSTS,
  getAllOjsHostnames,
  isOjsHost,
} from "@/src/features/ojs/utils/ojs-hosts"
import { resolveProfileImageUrl } from "@/src/features/journals/server/editorial-board-service"
import { mapOjsJournalRow } from "@/src/features/ojs/server/ojs-mappers"

describe("Host Classification Module", () => {
  it("correctly classifies canonical, alias, dead, and unknown-external hosts", () => {
    expect(CANONICAL_OJS_HOST).toBe("journals.digitopub.com")
    expect(isOjsHost("journals.digitopub.com")).toBe(true)

    // Alias hosts
    expect(OJS_ALIAS_HOSTS.has("submitmanager.com")).toBe(true)
    expect(OJS_ALIAS_HOSTS.has("ij-mp.com")).toBe(true)
    expect(OJS_ALIAS_HOSTS.has("digitodontics.com")).toBe(true)
    expect(isOjsHost("submitmanager.com")).toBe(true)
    expect(isOjsHost("www.ij-mp.com")).toBe(true)

    // Dead hosts (journals.zu.edu.ly was revived — verified serving 200s on
    // 2026-09-05 — so it must NOT be dead-listed; it is still not an OJS host)
    expect(DEAD_EXTERNAL_HOSTS.has("journals.zu.edu.ly")).toBe(false)
    expect(DEAD_EXTERNAL_HOSTS.has("jtr.cit.edu.ly")).toBe(true)
    expect(isOjsHost("journals.zu.edu.ly")).toBe(false)

    // Unknown external host
    expect(isOjsHost("cdn.example.com")).toBe(false)
  })

  it("includes env overrides in getAllOjsHostnames", () => {
    vi.stubEnv("OJS_BASE_URL", "https://custom-ojs.example.org")
    try {
      const hosts = getAllOjsHostnames()
      expect(hosts.has("custom-ojs.example.org")).toBe(true)
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe("resolveProfileImageUrl", () => {
  it("normalizes and proxies full URLs pointing to legacy alias hosts", () => {
    const rawAliasUrl = "https://submitmanager.com/public/site/profileImages/editor.jpg"
    const result = resolveProfileImageUrl(rawAliasUrl)

    expect(result).toBe("https://journals.digitopub.com/public/site/profileImages/editor.jpg")
    expect(result).not.toContain("submitmanager.com")
  })

  it("normalizes /ojs/public/ paths in full URLs", () => {
    const rawLegacyUrl = "https://submitmanager.com/ojs/public/site/profileImages/photo.png"
    const result = resolveProfileImageUrl(rawLegacyUrl)

    expect(result).toBe("https://journals.digitopub.com/public/site/profileImages/photo.png")
    expect(result).not.toContain("/ojs/public/")
  })

  it("returns null for dead external host URLs", () => {
    const deadUrl = "https://jtr.cit.edu.ly/public/site/profileImages/photo.jpg"
    const result = resolveProfileImageUrl(deadUrl)

    expect(result).toBeNull()
  })

  it("resolves JSON profile image filenames correctly", () => {
    const jsonVal = '{"dateUploaded":"2024-01-01","uploadName":"photo.jpg"}'
    const result = resolveProfileImageUrl(jsonVal)

    expect(result).toContain("/public/site/profileImages/photo.jpg")
  })
})

describe("ojs-mappers thumbnail URL builder", () => {
  it("prevents /ojs/public/ double-path leak when baseUrl includes /ojs", () => {
    const row = {
      journal_id: 10,
      path: "my-journal",
      primary_locale: "en_US",
      enabled: 1,
      name: "My Journal",
      description: "Test description",
      thumbnail: '{"en_US":{"name":"cover_issue_10_en.png"}}',
      issn: null,
      e_issn: null,
      publisher: null,
      abbreviation: null,
      contact_name: null,
      country: null,
    }

    const mapped = mapOjsJournalRow(row, "https://journals.digitopub.com/ojs")

    expect(mapped.thumbnail_url).toBe("https://journals.digitopub.com/public/journals/10/cover_issue_10_en.png")
    expect(mapped.thumbnail_url).not.toContain("/ojs/public/")
  })

  // #260: a trailing slash used to hide the /ojs suffix from the strip.
  it.each(["https://journals.digitopub.com/ojs/", "https://journals.digitopub.com/ojs//", "https://journals.digitopub.com/"])(
    "builds the same URL for base %s",
    (baseUrl) => {
      const mapped = mapOjsJournalRow(row(), baseUrl)
      expect(mapped.thumbnail_url).toBe("https://journals.digitopub.com/public/journals/10/cover_issue_10_en.png")
    },
  )
})

function row() {
  return {
    journal_id: 10,
    path: "my-journal",
    primary_locale: "en_US",
    enabled: 1,
    name: "My Journal",
    description: "Test description",
    thumbnail: '{"en_US":{"name":"cover_issue_10_en.png"}}',
    issn: null,
    e_issn: null,
    publisher: null,
    abbreviation: null,
    contact_name: null,
    country: null,
  }
}
