"use client"

import { useState, useMemo } from "react"
import Link from "next/link"
import { OjsImage } from "@/src/features/ojs/components/ojs-image"
import {
  ChevronDown,
  ChevronUp,
  User,
  FileText
} from "lucide-react"
import { useParams } from "next/navigation"
import DOMPurify from "dompurify"

import type { CurrentIssueArticle, CurrentIssueAuthor } from "@/src/features/journals"
import { OrcidIcon } from "@/components/orcid-icon"
import { normalizeOrcidId, orcidProfileUrl } from "@/src/lib/orcid"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { CitationBadge } from "@/components/citation-badge"
import { AudioPlayer } from "@/src/components/audio-player"

interface ArticleItemProps {
  article: CurrentIssueArticle
}

function sanitizeAbstract(html: string | null | undefined): string {
  if (!html) return ""
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li'],
    ALLOWED_ATTR: [],
  })
}

/**
 * Shared article card component used by both Current Issue and Archive Issue Detail.
 * Displays article cover, title, authors, abstract toggle, and action footer.
 */
export function ArticleItem({ article }: ArticleItemProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [hasCoverError, setHasCoverError] = useState(false)
  const params = useParams()
  const journalId = params?.id as string

  if (!journalId) return null

  const articleUrl = `/journals/${journalId}/articles/${article.publicationId}`

  return (
    <div className="group relative flex flex-col sm:flex-row rounded-2xl border border-border/40 bg-card overflow-hidden transition duration-300 hover:border-primary/40 hover:shadow-lg hover:-translate-y-1">
      {/* Visual Cover Area */}
      <div className="relative sm:w-56 md:w-64 flex-shrink-0 aspect-[16/9] sm:aspect-auto bg-muted/5 border-b sm:border-b-0 sm:border-r border-border/30 overflow-hidden sm:min-h-[280px]">
        {article.articleCoverUrl && !hasCoverError ? (
          <OjsImage
            src={article.articleCoverUrl}
            alt={`Cover for ${article.title || 'article'}`}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-contain object-center p-4 transition-transform duration-300 group-hover:scale-[1.02]"
            onError={() => setHasCoverError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/30 bg-gradient-to-br from-muted/20 to-muted/50">
            <FileText className="h-12 w-12 mb-2" strokeWidth={1} />
          </div>
        )}

        {/* Modern floating badge */}
        {article.sectionTitle && (
          <div className="absolute top-3 left-3">
            <Badge className="bg-background/90 text-foreground backdrop-blur-sm shadow-sm border-border/20 text-[10px] uppercase font-bold py-1 px-2.5">
              {article.sectionTitle}
            </Badge>
          </div>
        )}
      </div>

      <div className="p-4 sm:p-6 flex flex-col flex-1 gap-4 min-w-0">
        <div className="space-y-3 flex-1">
          {/* Title */}
          <Link href={articleUrl} className="focus:outline-none focus:ring-2 focus:ring-primary/20 rounded-sm">
            <h4 className="text-lg font-bold leading-tight line-clamp-3 group-hover:text-primary transition-colors">
              {article.title || "Untitled"}
            </h4>
          </Link>

          {/* Authors */}
          {article.authors && article.authors.length > 0 && (
            <AuthorList authors={article.authors} />
          )}

          {/* DOI */}
          {article.doi && (
            <div className="inline-flex items-center gap-1.5 mt-1 text-xs text-muted-foreground bg-muted/30 px-2 py-0.5 rounded-md border border-border/40 w-fit">
              <span className="font-bold">DOI</span>
              <Link
                href={`https://doi.org/${article.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                className="select-text hover:text-primary hover:underline transition-colors block break-all"
              >
                {article.doi}
              </Link>
            </div>
          )}

          {/* Keywords */}
          {article.keywords && article.keywords.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {article.keywords.map((kw) => (
                <Badge
                  key={kw}
                  variant="default"
                  className="px-2.5 py-0.5 rounded-full text-[12px] font-bold border border-border/40 cursor-default bg-primary/10 text-muted-foreground hover:text-primary-foreground"
                >
                  {kw}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {/* Abstract Toggle + Audio */}
        {(article.abstract || article.audioUrl) && (
          <div className="pt-2 relative z-20">
            <div className="flex items-center gap-3">
              {article.abstract && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault()
                    setIsExpanded(!isExpanded)
                  }}
                  aria-expanded={isExpanded}
                  aria-controls={`abstract-${article.publicationId}`}
                  className="group/btn flex items-center gap-1.5 text-[11px] font-bold text-primary hover:text-primary/80 uppercase tracking-wider transition-colors py-1.5 rounded-md focus:outline-none focus:ring-2 focus:ring-primary/20"
                >
                  {isExpanded ? (
                    <>
                      <ChevronUp className="h-3.5 w-3.5 group-hover/btn:-translate-y-0.5 transition-transform" />
                      <span>Hide Abstract</span>
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-3.5 w-3.5 group-hover/btn:translate-y-0.5 transition-transform" />
                      <span>View Abstract</span>
                    </>
                  )}
                </button>
              )}
              {article.audioUrl && (
                <AudioPlayer
                  src={article.audioUrl}
                  durationSeconds={article.audioDurationSeconds}
                  variant="compact"
                />
              )}
            </div>

            {article.abstract && (
              <div
                id={`abstract-${article.publicationId}`}
                role="region"
                aria-label={`Abstract for ${article.title}`}
                className={`overflow-hidden transition-all duration-300 ${isExpanded ? "mt-4 max-h-[400px] opacity-100" : "max-h-0 opacity-0"}`}
              >
                <div className="rounded-xl bg-muted/40 p-4 border border-border/30 overflow-y-auto max-h-[350px] scrollbar-thin">
                  <div
                    className="text-sm leading-relaxed text-muted-foreground prose prose-sm max-w-none dark:prose-invert"
                    // DOMPurify needs a DOM, so the abstract is sanitized only once the reader
                    // expands it (browser-only state); on the server it threw and the issue
                    // page's article list fell back to client rendering (#265).
                    dangerouslySetInnerHTML={{ __html: isExpanded ? sanitizeAbstract(article.abstract) : "" }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Footer */}
        <div className="pt-4 mt-auto border-t border-border/40 flex flex-wrap items-center justify-between gap-2 relative z-20">
          {article.datePublished ? (
            <span className="text-[11px] text-muted-foreground/80 font-bold uppercase tracking-wider">
              {new Date(article.datePublished).toLocaleDateString("en-US", { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })}
            </span>
          ) : (
            <span />
          )}

          <div className="flex flex-wrap items-center justify-end gap-2">
            <CitationBadge doi={article.doi} size="sm" />
            <Button asChild variant="outline" size="sm" className="h-8 gap-2 rounded-full px-4">
              <Link href={articleUrl}>
                View Article
              </Link>
            </Button>
            {article.pdfUrl && (
              <Button asChild variant="ghost" size="sm" className="h-8 gap-2 text-primary hover:bg-primary/10 rounded-full px-4">
                <a
                  href={article.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`View PDF for ${article.title || 'article'}`}
                >
                  <FileText className="h-3.5 w-3.5 opacity-70" />
                  View PDF
                </a>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Author list ──────────────────────────────────────────────────────

interface AuthorListProps {
  authors: CurrentIssueAuthor[]
}

function AuthorList({ authors }: AuthorListProps) {
  const named = useMemo(
    () =>
      authors.filter((a) => {
        const name = `${a.givenName || ""} ${a.familyName || ""}`.trim()
        return name.length > 0
      }),
    [authors]
  )

  const useGrid = named.length >= 3

  if (named.length === 0) return null

  return (
    <div className="flex items-start gap-2.5">
      <User className="h-4 w-4 shrink-0 mt-0.5 text-primary/60" />
      <div
        className={
          useGrid
            ? "grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 w-full"
            : "flex flex-col gap-2 w-full"
        }
      >
        {named.map((author) => {
          const name = `${author.givenName || ""} ${author.familyName || ""}`.trim()
          const key = `${author.givenName ?? ""}-${author.familyName ?? ""}`
          const orcidId = normalizeOrcidId(author.orcid)
          return (
            <div key={key} className="flex flex-col min-w-0">
              <span className="flex items-center gap-1.5 min-w-0">
                <span className="text-sm font-semibold text-foreground/80 leading-snug truncate">
                  {name}
                </span>
                {orcidId && (
                  <a
                    href={orcidProfileUrl(orcidId)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`ORCID profile of ${name}`}
                    title="ORCID profile"
                    className="inline-flex shrink-0 rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A6CE39]/60"
                  >
                    <OrcidIcon className="h-3.5 w-3.5" />
                  </a>
                )}
              </span>
              {author.affiliation && (
                <span className="text-[11px] text-muted-foreground leading-tight line-clamp-1">
                  {author.affiliation}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
