/**
 * TypeScript interfaces for the Current Issue feature.
 *
 * These types represent the transformed data from OJS database tables:
 * - issues + issue_settings         → CurrentIssue
 * - publications + publication_settings → CurrentIssueArticle
 * - authors + author_settings       → CurrentIssueAuthor
 *
 * All field names are camelCase (mapped from OJS snake_case in the service layer).
 */

export interface CurrentIssueAuthor {
  givenName: string | null
  familyName: string | null
  affiliation?: string | null
  /** Byline ORCID iD as stored in OJS (bare or orcid.org URL); see normalizeOrcidId. */
  orcid?: string | null
}

export interface CurrentIssueArticle {
  publicationId: number
  submissionId: number
  title: string | null
  abstract: string | null
  authors: CurrentIssueAuthor[]
  datePublished: string | null
  sectionTitle: string | null
  sectionId: number | null
  articleCoverUrl: string | null
  /** Inline-viewer URL (proxy). See ArticleDetail.pdfUrl for the rationale. */
  pdfUrl: string | null
  /** Clean shareable OJS download URL. See ArticleDetail.pdfDownloadUrl. */
  pdfDownloadUrl: string | null
  doi?: string | null
  keywords?: string[]
  isOpenAccess: boolean
  audioUrl?: string | null
  audioDurationSeconds?: number | null
}

export interface CurrentIssue {
  issueId: number
  title: string | null
  volume: number | null
  number: string | null
  year: number | null
  datePublished: string | null
  description: string | null
  showVolume: boolean
  showNumber: boolean
  showYear: boolean
  showTitle: boolean
  urlPath: string | null
  articles: CurrentIssueArticle[]
  issueCoverUrl: string | null
}
