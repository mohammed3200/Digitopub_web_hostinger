"use client"

import { Download, FileText, BarChart3, Quote, Share2 } from "lucide-react"
import { useState } from "react"
import type { ArticleDetail } from "@/src/features/journals"
import { CitationBox } from "./citation-box"
import { Button } from "@/components/ui/button"
import { CitationBadge, DIMENSIONS_BADGES_ENABLED } from "@/components/citation-badge"

interface ArticleSidebarProps {
  article: ArticleDetail
}

export function ArticleSidebar({ article }: ArticleSidebarProps) {
  const [shared, setShared] = useState(false)

  const handleShare = async () => {
    if (typeof window === "undefined") return
    const url = window.location.href
    const nav = window.navigator as Navigator & {
      share?: (data: ShareData) => Promise<void>
    }
    try {
      if (typeof nav.share === "function") {
        await nav.share({
          title: article.title || "Article",
          text: article.title || "",
          url,
        })
        return
      }
      await nav.clipboard.writeText(url)
      setShared(true)
      setTimeout(() => setShared(false), 2000)
    } catch {
      /* user aborted share or clipboard blocked */
    }
  }

  return (
    <div className="space-y-6">
      {/* Full Text */}
      <div className="rounded-xl border border-border/60 bg-card p-5 space-y-4 shadow-sm">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" /> Full Text
        </h3>

        {article.pdfUrl ? (
          <div className="space-y-2">
            <Button
              asChild
              className="w-full font-bold h-12 shadow-sm rounded-xl gap-2"
            >
              <a
                href={article.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <FileText className="h-5 w-5" /> View PDF
              </a>
            </Button>
            {article.pdfDownloadUrl && (
              <Button
                asChild
                variant="outline"
                className="w-full font-semibold h-10 rounded-xl gap-2"
              >
                <a
                  href={article.pdfDownloadUrl}
                  download
                >
                  <Download className="h-4 w-4" /> Download PDF
                </a>
              </Button>
            )}
          </div>
        ) : (
          <div className="p-4 rounded-lg bg-muted/40 border border-border/40 text-center">
            <p className="text-sm text-muted-foreground font-medium">PDF not available</p>
          </div>
        )}

        <button
          type="button"
          onClick={handleShare}
          className="w-full h-10 rounded-lg text-sm font-semibold border border-border/50 bg-background hover:bg-muted/50 text-foreground/80 inline-flex items-center justify-center gap-2 transition-colors"
        >
          <Share2 className="h-4 w-4" />
          {shared ? "Link copied" : "Share article"}
        </button>
      </div>

      {/* Metrics */}
      <div className="rounded-xl border border-border/60 bg-card p-5 space-y-4 shadow-sm">
        <h3 className="font-semibold text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" /> Article Metrics
        </h3>
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            icon={<Quote className="h-4 w-4 text-muted-foreground" />}
            label="References"
            value={article.citations || 0}
          />
          <MetricCard
            icon={<Download className="h-4 w-4 text-muted-foreground" />}
            label="Downloads"
            value={article.downloads || 0}
          />
        </div>
      </div>

      {/* Times cited */}
      {article.doi && (
        <div className="rounded-xl border border-border/60 bg-card p-5 space-y-3 shadow-sm">
          <h3 className="font-semibold text-base">Citation Metrics</h3>
          <CitationBadge doi={article.doi} size="md" />
          <p className="text-xs text-muted-foreground">
            {DIMENSIONS_BADGES_ENABLED
              ? "Citation data from Dimensions."
              : "Times cited, from Crossref and OpenAlex. Updated daily."}
          </p>
        </div>
      )}

      {/* Citation Box */}
      <CitationBox article={article} />
    </div>
  )
}

interface MetricCardProps {
  icon: React.ReactNode
  label: string
  value: number
}

function MetricCard({ icon, label, value }: MetricCardProps) {
  return (
    <div className="flex flex-col items-center justify-center p-4 rounded-lg bg-muted/30 border border-border/40">
      <div className="mb-2">{icon}</div>
      <span className="text-2xl font-bold text-foreground tabular-nums">
        {value.toLocaleString()}
      </span>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mt-1">
        {label}
      </span>
    </div>
  )
}
