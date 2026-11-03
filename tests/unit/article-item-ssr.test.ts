import { describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { CurrentIssueArticle } from "@/src/features/journals"

// Vitest runs in Node with no DOM, exactly like the server render of an issue page.
vi.mock("next/navigation", () => ({ useParams: () => ({ id: "ijmp" }) }))

const article: CurrentIssueArticle = {
  publicationId: 1,
  submissionId: 10,
  title: "A Study",
  abstract: "<p>Background <script>alert(1)</script><strong>results</strong></p>",
  authors: [{ givenName: "Ada", familyName: "Lovelace", affiliation: "Uni", orcid: "0000-0002-1825-0097" }],
  datePublished: "2025-05-07",
  sectionTitle: "Editorial",
  sectionId: 1,
  articleCoverUrl: null,
  pdfUrl: null,
  pdfDownloadUrl: null,
  doi: null,
  isOpenAccess: true,
}

describe("ArticleItem server render (#265)", () => {
  it("renders an article that has an abstract without throwing", async () => {
    const { ArticleItem } = await import("@/app/journals/[id]/components/article-item")
    // The app provides React Query from its root layout (CitationBadge uses it).
    const html = renderToStaticMarkup(
      createElement(QueryClientProvider, { client: new QueryClient() }, createElement(ArticleItem, { article })),
    )
    expect(html).toContain("A Study")
    expect(html).toContain("ORCID profile of Ada Lovelace")
    // The collapsed abstract is built in the browser on expand, so no raw abstract HTML reaches the server markup.
    expect(html).not.toContain("<script>")
  })
})
