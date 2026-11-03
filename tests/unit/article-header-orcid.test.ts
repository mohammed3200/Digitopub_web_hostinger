import { describe, expect, it } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { ArticleDetail } from "@/src/features/journals"

const article = {
  publicationId: 1,
  submissionId: 10,
  journalId: 2,
  title: "A Study",
  abstract: null,
  doi: null,
  keywords: [],
  pages: null,
  datePublished: null,
  locale: "en",
  authors: [
    { givenName: "Ada", familyName: "Lovelace", affiliation: "Uni", orcid: "https://orcid.org/0000-0002-1825-0097" },
    { givenName: "Bo", familyName: "Li", affiliation: null, orcid: null },
  ],
  sectionTitle: null,
  articleCoverUrl: null,
  galleys: [],
  pdfUrl: null,
  pdfDownloadUrl: null,
  issueId: 1,
  issueTitle: null,
  volume: null,
  issueNumber: null,
  year: null,
  journalTitle: "J",
  journalAbbreviation: null,
  issn: null,
  eIssn: null,
  journalUrlPath: "ijmp",
  isOpenAccess: true,
} as unknown as ArticleDetail

describe("ArticleHeader author ORCID (#263)", () => {
  it("links the iD icon after the name and shows no iD text", async () => {
    const { ArticleHeader } = await import("@/app/journals/[id]/articles/[publicationId]/components/article-header")
    const html = renderToStaticMarkup(createElement(ArticleHeader, { article }))
    expect(html).toContain('href="https://orcid.org/0000-0002-1825-0097"')
    expect(html).toContain('aria-label="ORCID profile of Ada Lovelace"')
    expect(html.match(/href="https:\/\/orcid\.org\//g)).toHaveLength(1)
    expect(html).not.toContain(">https://orcid.org/")
  })
})
