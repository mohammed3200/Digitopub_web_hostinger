// Server Component — no interactivity, fully SSR-rendered for SEO

import Link from "next/link"
import { OjsImage } from "@/src/features/ojs/components/ojs-image"
import { ChevronRight, Calendar, FileText, BookOpen, Hash } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { DoiCopyButton } from "./doi-copy-button"
import { OrcidIcon } from "@/components/orcid-icon"
import { normalizeOrcidId, orcidProfileUrl } from "@/src/lib/orcid"
import type { ArticleDetail } from "@/src/features/journals"

interface ArticleHeaderProps {
  article: ArticleDetail
}

export function ArticleHeader({ article }: ArticleHeaderProps) {
  const publishedDate =
    article.datePublished && !isNaN(new Date(article.datePublished).getTime())
      ? new Date(article.datePublished)
      : null

  const issueLabel =
    article.volume != null && article.issueNumber != null
      ? `Vol. ${article.volume} No. ${article.issueNumber}${article.year ? ` (${article.year})` : ""}`
      : null

  return (
    <header className="space-y-8">
      {/* Breadcrumbs */}
      <nav className="flex flex-wrap items-center text-sm font-medium text-muted-foreground gap-x-2 gap-y-1">
        <Link
          href={`/journals/${article.journalUrlPath}`}
          className="hover:text-primary transition-colors"
        >
          {article.journalAbbreviation || article.journalTitle}
        </Link>
        <ChevronRight className="h-4 w-4 opacity-50" />
        {issueLabel ? (
          <Link
            href={`/journals/${article.journalUrlPath}/issues/${article.volume}/${article.issueNumber}`}
            className="hover:text-primary transition-colors"
          >
            {issueLabel}
          </Link>
        ) : (
          <span className="text-muted-foreground/60 italic">Unassigned Issue</span>
        )}
        <ChevronRight className="h-4 w-4 opacity-50" />
        <span className="text-foreground line-clamp-1">{article.title}</span>
      </nav>

      {/* Hero */}
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-10 items-start">
        <div className="space-y-5 order-2 lg:order-1 min-w-0">
          {article.sectionTitle && (
            <Badge className="bg-primary/10 text-primary hover:bg-primary/15 hover:text-primary tracking-wide text-[11px] uppercase font-bold px-3 py-1">
              {article.sectionTitle}
            </Badge>
          )}

          <h1 className="text-2xl sm:text-3xl lg:text-[2.4rem] font-extrabold tracking-tight text-foreground leading-[1.15]">
            {article.title || "Untitled Article"}
          </h1>

          <dl className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {publishedDate && (
              <div className="flex items-center gap-2">
                <Calendar className="h-4 w-4 text-primary/70" />
                <dt className="sr-only">Published</dt>
                <dd>
                  <span className="font-medium text-foreground/80">Published:</span>{" "}
                  {publishedDate.toLocaleDateString(undefined, {
                    month: "long",
                    day: "numeric",
                    year: "numeric",
                  })}
                </dd>
              </div>
            )}

            {article.pages && (
              <div className="flex items-center gap-2">
                <Hash className="h-4 w-4 text-primary/70" />
                <dt className="sr-only">Pages</dt>
                <dd>
                  <span className="font-medium text-foreground/80">Pages:</span> {article.pages}
                </dd>
              </div>
            )}

            {(article.issn || article.eIssn) && (
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary/70" />
                <dt className="sr-only">ISSN</dt>
                <dd className="font-mono text-xs">
                  {article.issn && <span>ISSN {article.issn}</span>}
                  {article.issn && article.eIssn && <span className="mx-1 opacity-50">·</span>}
                  {article.eIssn && <span>e-ISSN {article.eIssn}</span>}
                </dd>
              </div>
            )}

            {article.doi && <DoiCopyButton doi={article.doi} />}
          </dl>
        </div>

        {/* Cover image */}
        <div className="order-1 lg:order-2 w-full max-w-[220px] mx-auto lg:mx-0">
          <div className="relative aspect-[3/4] w-full rounded-xl overflow-hidden border border-border/60 bg-muted/30 shadow-sm">
            {article.articleCoverUrl ? (
              <OjsImage
                src={article.articleCoverUrl}
                alt={`Cover for ${article.title || "article"}`}
                fill
                sizes="(max-width: 1024px) 220px, 220px"
                className="object-contain p-3"
                fallback={
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/50 bg-gradient-to-br from-muted/40 to-muted/70">
                    <FileText className="h-10 w-10 mb-2" strokeWidth={1.25} />
                    <span className="text-[10px] font-semibold uppercase tracking-wider">
                      No cover
                    </span>
                  </div>
                }
              />
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/50 bg-gradient-to-br from-muted/40 to-muted/70">
                <FileText className="h-10 w-10 mb-2" strokeWidth={1.25} />
                <span className="text-[10px] font-semibold uppercase tracking-wider">
                  No cover
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Authors */}
      {article.authors.length > 0 && (
        <div className="pt-6 border-t border-border/40">
          <h2 className="text-[11px] font-bold text-muted-foreground uppercase tracking-[0.2em] mb-4">
            {article.authors.length === 1 ? "Author" : "Authors"}
          </h2>
          <ul className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
            {article.authors.map((author) => {
              const fullName = `${author.givenName || ""} ${author.familyName || ""}`.trim() || "Unknown Author"
              const initials = `${(author.givenName || "?").charAt(0)}${(author.familyName || "").charAt(0)}`.toUpperCase()
              const orcidId = normalizeOrcidId(author.orcid)
              const orcidUrl = orcidId ? orcidProfileUrl(orcidId) : null

              return (
                <li key={author.orcid ?? fullName} className="flex gap-3 group">
                  <div className="mt-0.5 h-10 w-10 shrink-0 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                    {initials || "?"}
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="font-bold text-foreground text-base leading-tight">
                      {fullName}
                      {orcidUrl && (
                        <a
                          href={orcidUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`ORCID profile of ${fullName}`}
                          title="ORCID profile"
                          className="ml-1.5 inline-flex align-[-2px] rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#A6CE39]/60"
                        >
                          <OrcidIcon />
                        </a>
                      )}
                    </span>
                    {author.affiliation ? (
                      <span className="text-xs text-muted-foreground leading-relaxed font-medium">
                        {author.affiliation}
                      </span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground/60 italic">
                        Affiliation not provided
                      </span>
                    )}
                    {orcidUrl && (
                      <a
                        href={orcidUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-primary hover:underline w-fit break-all"
                      >
                        {orcidUrl}
                      </a>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </header>
  )
}
