"use client"

import { useId } from "react"
import { cn } from "@/src/lib/utils"
import { normalizeCitationDoi, useCitationCount } from "@/src/features/metrics/api/use-citation-counts"
import { DimensionsBadge } from "@/components/dimensions-badge"

interface CitationBadgeProps {
  doi: string | null | undefined
  size?: "sm" | "md"
  className?: string
}

const SIZES = {
  sm: { box: "h-9 w-9", num: "text-[11px]", caption: "text-[10px]" },
  md: { box: "h-14 w-14", num: "text-base", caption: "text-xs" },
} as const

const SOURCE_LABEL = { crossref: "Crossref", openalex: "OpenAlex" } as const

/**
 * Official Dimensions badges (#258) instead of our hexagon. Off until
 * Digital Science licenses DigitoPub as a publisher; inlined at build time,
 * so turning it on is an env change plus a redeploy.
 */
export const DIMENSIONS_BADGES_ENABLED = process.env.NEXT_PUBLIC_DIMENSIONS_BADGES === "true"

export function CitationBadge(props: CitationBadgeProps) {
  if (DIMENSIONS_BADGES_ENABLED) {
    const doi = normalizeCitationDoi(props.doi)
    if (!doi) return null
    return <DimensionsBadge doi={doi} badgeStyle={props.size === "md" ? "medium_circle" : "small_circle"} className={props.className} />
  }
  return <HexagonCitationBadge {...props} />
}

/** Our own badge, filled daily from Crossref and OpenAlex (#232). */
function HexagonCitationBadge({ doi, size = "sm", className }: CitationBadgeProps) {
  const gradientId = useId()
  const normalized = normalizeCitationDoi(doi)
  const { data, isLoading } = useCitationCount(doi)
  if (!normalized) return null
  // Settled without a count (not counted yet, or the request failed): show nothing.
  if (!isLoading && !data) return null

  const s = SIZES[size]
  const hexagon = (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", s.box)}>
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--primary)" />
            <stop offset="100%" stopColor="#14b8a6" />
          </linearGradient>
        </defs>
        <polygon
          points="50,4 90,27 90,73 50,96 10,73 10,27"
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth="6"
          strokeLinejoin="round"
        />
      </svg>
      <span className={cn("relative font-bold tabular-nums leading-none text-foreground", s.num)}>
        {data ? data.count.toLocaleString() : "–"}
      </span>
    </span>
  )

  const caption = <span className={cn("font-medium text-muted-foreground leading-tight", s.caption)}>citations</span>
  const layout = "inline-flex items-center gap-1.5"

  if (!data) {
    // Loading: same size as the badge, so nothing shifts when it arrives.
    return (
      <span className={cn(layout, "opacity-60", className)} aria-hidden="true">
        {hexagon}
        {caption}
      </span>
    )
  }

  const label = `${data.count} ${data.count === 1 ? "citation" : "citations"} (source: ${SOURCE_LABEL[data.source]})`
  // Not a link: neither Crossref nor OpenAlex has a public "cited by" page
  // addressable by DOI, and linking to the article itself would mislead.
  return (
    <span
      role="img"
      aria-label={label}
      title={`${label}. Updated daily.`}
      className={cn(
        layout,
        "rounded-md",
        "motion-safe:transition motion-safe:hover:scale-105",
        "hover:drop-shadow-[0_0_6px_color-mix(in_oklch,var(--primary)_45%,transparent)]",
        className
      )}
    >
      {hexagon}
      {caption}
    </span>
  )
}
