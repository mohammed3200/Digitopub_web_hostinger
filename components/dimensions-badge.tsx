"use client"

import Script from "next/script"
import { useEffect } from "react"
import { cn } from "@/src/lib/utils"

/**
 * The official Dimensions citation badge (#258). Docs:
 * https://integration-dimensions-badge.digital-science.com/
 *
 * Dimensions' script turns each `.__dimensions_badge_embed__` span into a
 * badge with the live citation count and a hover legend linking to the
 * Dimensions details page. Their terms require a publisher licence, so this
 * is only rendered when NEXT_PUBLIC_DIMENSIONS_BADGES is "true".
 */

const BADGE_SCRIPT = "https://badge.dimensions.ai/badge.js"

declare global {
  interface Window {
    __dimensions_embed?: { addBadges: () => void }
  }
}

export type DimensionsBadgeStyle = "small_circle" | "medium_circle" | "large_circle" | "small_rectangle" | "large_rectangle"

interface DimensionsBadgeProps {
  /** Bare DOI ("10.26629/…"). */
  doi: string
  badgeStyle?: DimensionsBadgeStyle
  className?: string
}

/** Badges added after the script ran (lists, client-side navigation) need this call. */
function addBadges() {
  window.__dimensions_embed?.addBadges()
}

export function DimensionsBadge({ doi, badgeStyle = "medium_circle", className }: DimensionsBadgeProps) {
  // The script loads once per document; onReady below covers the first load,
  // this covers a DOI change on an already mounted badge.
  useEffect(addBadges, [doi])

  return (
    <>
      <span
        key={doi}
        className={cn("__dimensions_badge_embed__ inline-block", className)}
        data-doi={doi}
        data-style={badgeStyle}
        // No data-legend: Dimensions opens the hover legend on whichever side
        // has room. Every fixed side clipped somewhere on a phone, and touch
        // devices rarely hover anyway (a tap opens the Dimensions page).
      />
      <Script id="dimensions-badge-js" src={BADGE_SCRIPT} strategy="afterInteractive" onReady={addBadges} />
    </>
  )
}
