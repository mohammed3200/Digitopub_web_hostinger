import { describe, expect, it, vi } from "vitest"

const ojsQuery = vi.fn(async (sql: string): Promise<unknown[]> => {
  if (sql.includes("FROM publications p") && sql.includes("ps_title")) {
    return [{ publication_id: 1, date_published: null, pub_seq: 0, submission_id: 10, title: "T", abstract: null, section_id: null, section_seq: 0, section_title: null, cover_image_raw: null, doi: null, access_status: null }]
  }
  if (sql.includes("FROM authors a")) return [{ author_id: 7, publication_id: 1, seq: 0 }, { author_id: 8, publication_id: 1, seq: 1 }]
  if (sql.includes("FROM author_settings")) {
    return [
      { author_id: 7, locale: "en", setting_name: "givenName", setting_value: "Ada" },
      { author_id: 7, locale: "", setting_name: "orcid", setting_value: "https://orcid.org/0000-0002-1825-0097" },
      { author_id: 8, locale: "en", setting_name: "givenName", setting_value: "Bo" },
    ]
  }
  return []
})

vi.mock("@/src/features/ojs/server/ojs-client", () => ({ ojsQuery: (sql: string) => ojsQuery(sql) }))
// The article-audio lookup reads the local DB; keep the test off any real connection.
vi.mock("@/src/lib/db/config", () => ({ prisma: { articleAudio: { findMany: async () => [] } } }))

describe("fetchArticlesWithAuthors maps byline ORCID iDs for the article cards (#263)", () => {
  it("carries the orcid setting, and null when an author has none", async () => {
    const { fetchArticlesWithAuthors } = await import("@/src/features/journals/server/ojs-article-utils")
    const [article] = await fetchArticlesWithAuthors(1, 1, "en", "ijmp")
    expect(article.authors.map((a) => [a.givenName, a.orcid])).toEqual([
      ["Ada", "https://orcid.org/0000-0002-1825-0097"],
      ["Bo", null],
    ])
  })
})
