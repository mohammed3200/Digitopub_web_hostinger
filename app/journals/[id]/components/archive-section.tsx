"use client"

import { useState } from "react"
import { OjsImage } from "@/src/features/ojs/components/ojs-image"
import Link from "next/link"
import {
  Archive,
  BookOpen,
  Calendar,
  FileText,
  ArrowRight,
  Share2,
  Check,
} from "lucide-react"
import { toast } from "sonner"

import { useGetArchiveIssues, type ArchiveIssue } from "@/src/features/journals"
import { Badge } from "@/components/ui/badge"
import { ArchiveSkeleton } from "@/components/skeletons/archive-skeleton"
import { ArchiveError } from "@/components/errors/archive-error"
import { getIssueTitle, getIssueSubtitle } from "./issue-helpers"

interface ArchiveSectionProps {
  journalId: string
}

export function ArchiveSection({ journalId }: ArchiveSectionProps) {
  const { data: response, isLoading, error, refetch } = useGetArchiveIssues(journalId)
  const archiveIssues = response?.data || []

  if (isLoading) return <ArchiveSkeleton />
  if (error) return <ArchiveError retry={() => refetch()} />
  if (archiveIssues.length === 0) {
    return <ArchiveEmpty message={response?.message} />
  }

  // ── Archive Grid ──────────────────────────────────────────────
  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-primary/10">
            <Archive className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="text-xl font-bold">Past Issues</h2>
            <p className="text-sm text-muted-foreground">
              {archiveIssues.length} archived issue{archiveIssues.length !== 1 ? "s" : ""}
            </p>
          </div>
        </div>
      </div>

      {/* Grid of Issue Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {archiveIssues.map((issue) => (
          <ArchiveIssueCard
            key={issue.issueId}
            issue={issue}
            journalId={journalId}
          />
        ))}
      </div>
    </div>
  )
}

// ── Lazy import for ArchiveEmpty ─────────────────────────────────────
function ArchiveEmpty({ message }: { message?: string }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-8 text-center">
      <p className="text-muted-foreground">
        {message || "No archived issues found."}
      </p>
    </div>
  )
}

// ─── Archive Issue Card ─────────────────────────────────────────────

function ArchiveIssueCard({
  issue,
  journalId,
}: {
  issue: ArchiveIssue
  journalId: string
}) {
  const [hasCoverError, setHasCoverError] = useState(false)
  const [copied, setCopied] = useState(false)

  const issueHref =
    issue.volume != null && issue.number != null
      ? `/journals/${journalId}/issues/${issue.volume}/${issue.number}`
      : null

  const handleShare = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!issueHref) return

    const fullUrl = `${window.location.origin}${issueHref}`
    try {
      await navigator.clipboard.writeText(fullUrl)
      setCopied(true)
      toast.success("Issue link copied to clipboard")
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Failed to copy link")
    }
  }

  const cardContent = (
    <>
      {/* Cover Image */}
      <div className="relative aspect-[3/4] w-full bg-gradient-to-br from-muted/30 to-muted/60 overflow-hidden">
        {issue.issueCoverUrl && !hasCoverError ? (
          <OjsImage
            src={issue.issueCoverUrl}
            alt={getIssueTitle(issue)}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
            onError={() => setHasCoverError(true)}
          />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground/30">
            <BookOpen className="h-16 w-16 mb-3" strokeWidth={1} />
            <span className="text-xs uppercase tracking-widest font-semibold opacity-50">
              No Cover
            </span>
          </div>
        )}

        {/* Article count badge */}
        <div className="absolute top-3 right-3">
          <Badge className="bg-background/90 text-foreground backdrop-blur-md shadow-md border-border/30 text-[10px] font-bold py-1 px-2.5 gap-1">
            <FileText className="h-3 w-3" />
            {issue.articleCount} {issue.articleCount === 1 ? "article" : "articles"}
          </Badge>
        </div>

        {/* Hover overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        {/* Hover CTA */}
        <div className="absolute bottom-4 left-4 right-4 opacity-0 group-hover:opacity-100 translate-y-2 group-hover:translate-y-0 transition duration-300">
          <div className="flex items-center justify-center gap-2 bg-primary text-primary-foreground rounded-full py-2.5 px-5 text-sm font-semibold shadow-lg">
            View Issue
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-5 flex-1 flex flex-col gap-2">
        <h3 className="font-bold text-base leading-tight line-clamp-2 group-hover:text-primary transition-colors">
          {getIssueTitle(issue)}
        </h3>

        {getIssueSubtitle(issue) && (
          <p className="text-sm text-muted-foreground font-medium">
            {getIssueSubtitle(issue)}
          </p>
        )}

        <div className="flex items-center justify-between mt-auto pt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-4">
            {issue.datePublished && (
              <span className="flex items-center gap-1.5">
                <Calendar className="h-3.5 w-3.5" />
                {new Date(issue.datePublished).toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  timeZone: "UTC",
                })}
              </span>
            )}
          </div>

          {/* Share button */}
          {issueHref && (
            <button
              type="button"
              onClick={handleShare}
              className="p-1.5 rounded-full hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/20"
              aria-label="Copy issue link"
              title="Copy issue link"
            >
              {copied ? (
                <Check className="h-3.5 w-3.5 text-emerald-500" />
              ) : (
                <Share2 className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>
    </>
  )

  if (issueHref) {
    return (
      <Link
        href={issueHref}
        id={`archive-issue-${issue.issueId}`}
        className="group relative flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm transition duration-300 hover:border-primary/40 hover:shadow-xl hover:-translate-y-1.5 text-left focus:outline-none focus:ring-2 focus:ring-primary/30 focus:ring-offset-2"
      >
        {cardContent}
      </Link>
    )
  }

  // Fallback for issues without volume/number — not linkable
  return (
    <div
      id={`archive-issue-${issue.issueId}`}
      className="group relative flex flex-col rounded-2xl border border-border/50 bg-card overflow-hidden shadow-sm text-left opacity-75"
    >
      {cardContent}
    </div>
  )
}
