"use client"

import { useCallback, useEffect, useRef, useState } from "react"

/**
 * Horizontal tab strip helpers for narrow screens (#270).
 *
 * - Centres the active tab in the strip whenever it changes, so deep links
 *   such as `/policies` show their tab. It sets `scrollLeft` on the strip
 *   only; `scrollIntoView` would also scroll the page vertically.
 * - Reports whether more tabs are hidden to the right, so the caller can show
 *   an edge fade as a "this scrolls" cue.
 *
 * The strip must be `position: relative` so `offsetLeft` is measured from it.
 */
export function useTabStrip(activeKey: string, ready: boolean) {
  const listRef = useRef<HTMLDivElement>(null)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const update = useCallback(() => {
    const list = listRef.current
    if (!list) return
    setCanScrollRight(list.scrollLeft + list.clientWidth < list.scrollWidth - 1)
  }, [])

  useEffect(() => {
    const list = listRef.current
    if (!ready || !list) return
    const active = list.querySelector<HTMLElement>('[data-state="active"]')
    if (active && list.scrollWidth > list.clientWidth) {
      list.scrollLeft = active.offsetLeft - (list.clientWidth - active.offsetWidth) / 2
    }
    update()
  }, [activeKey, ready, update])

  useEffect(() => {
    const list = listRef.current
    if (!ready || !list || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver(update)
    observer.observe(list)
    return () => observer.disconnect()
  }, [ready, update])

  return { listRef, canScrollRight, onScroll: update }
}
