"use client"

import { useState, useEffect, useRef, type RefObject } from "react"
import { ABOUT_METADATA } from "@/src/features/journals/about-slugs"

export interface UseAboutScrollSpyOptions {
  journalId: string
  initialAboutSlug?: string | null
  activeTab: string
  isReady: boolean
}

export interface UseAboutScrollSpyReturn {
  activeAboutSlug: string | null
  setActiveAboutSlug: (slug: string | null) => void
  handleAboutPillClick: (slug: string) => void
}

/**
 * Manages deep linking, IntersectionObserver-based scroll-spy, and programmatic
 * smooth scroll for the About Journal subsections.
 * Prevents scroll oscillations (#150) using ref-tracked live slugs and lockouts.
 *
 * URL updates use the native History API, never the router (#275): a
 * router.replace/push is a real navigation into the [...tab] route that
 * remounts the whole view, so the boards re-render, the page height changes
 * and the scroll position jumps. Next integrates pushState/replaceState
 * with usePathname without a server round-trip.
 */
export function useAboutScrollSpy({
  journalId,
  initialAboutSlug = null,
  activeTab,
  isReady,
}: UseAboutScrollSpyOptions): UseAboutScrollSpyReturn {
  const [activeAboutSlug, setActiveAboutSlug] = useState<string | null>(initialAboutSlug)
  const [prevInitialAbout, setPrevInitialAbout] = useState(initialAboutSlug)
  const isProgrammaticScroll = useRef(false)
  const scrollResetTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Track the initial mount scroll so subsequent URL changes (e.g. from
  // the scroll-spy IntersectionObserver) do not re-trigger programmatic scroll.
  const hasInitialScrolledRef = useRef(false)

  // Synchronize state during render when initialAboutSlug prop changes
  // (official React pattern for adjusting state from props; no refs mutated here).
  if (prevInitialAbout !== initialAboutSlug) {
    setPrevInitialAbout(initialAboutSlug)
    setActiveAboutSlug(initialAboutSlug)
  }

  // Ref tracks the "live" slug so the IntersectionObserver callback never
  // goes stale *and* the observer doesn't rebuild on every slug change.
  // Updated in useEffect to adhere to React rules (no ref mutations during render).
  const activeAboutSlugRef = useRef(activeAboutSlug)
  useEffect(() => {
    activeAboutSlugRef.current = activeAboutSlug
  }, [activeAboutSlug])

  // Initial scroll-to-section on mount — fires once when journal data is ready,
  // then locks itself out so scroll-spy URL updates never oscillate (#150).
  useEffect(() => {
    if (!isReady) return
    if (hasInitialScrolledRef.current) return
    if (activeTab !== "about" || !initialAboutSlug) return

    hasInitialScrolledRef.current = true
    let initialResetTimer: ReturnType<typeof setTimeout> | undefined

    const timer = setTimeout(() => {
      const el = document.getElementById(`about-${initialAboutSlug}`)
      if (el) {
        isProgrammaticScroll.current = true
        // Calculate offset to account for sticky navbar + pills
        const yOffset = -140
        const y = el.getBoundingClientRect().top + window.scrollY + yOffset
        window.scrollTo({ top: y, behavior: "smooth" })

        // Clear any previous reset timer before scheduling new one
        if (scrollResetTimerRef.current) {
          clearTimeout(scrollResetTimerRef.current)
        }
        initialResetTimer = setTimeout(() => {
          isProgrammaticScroll.current = false
          if (scrollResetTimerRef.current === initialResetTimer) {
            scrollResetTimerRef.current = undefined
          }
        }, 1000)
        scrollResetTimerRef.current = initialResetTimer
      }
    }, 100)

    return () => {
      clearTimeout(timer)
      if (scrollResetTimerRef.current) {
        clearTimeout(scrollResetTimerRef.current)
        scrollResetTimerRef.current = undefined
      }
      isProgrammaticScroll.current = false
    }
  }, [activeTab, initialAboutSlug, isReady])

  // Clear any pending scroll reset timer when component unmounts
  useEffect(() => {
    return () => {
      if (scrollResetTimerRef.current) {
        clearTimeout(scrollResetTimerRef.current)
      }
    }
  }, [])

  // IntersectionObserver to update active pill + URL on scroll.
  // Deps intentionally exclude activeAboutSlug — we read it from a ref
  // to avoid tearing down / rebuilding the observer on every scroll-spy
  // update, which was a key contributor to the oscillation bug (#150).
  useEffect(() => {
    if (!isReady) return
    if (activeTab !== "about") return

    const observer = new IntersectionObserver(
      (entries) => {
        if (isProgrammaticScroll.current) return

        const visibleEntries = entries.filter((e) => e.isIntersecting)
        if (visibleEntries.length > 0) {
          const mostVisible = visibleEntries.reduce((prev, current) =>
            current.intersectionRatio > prev.intersectionRatio ? current : prev
          )
          const newSlug = mostVisible.target.id.replace("about-", "")

          if (newSlug !== activeAboutSlugRef.current) {
            activeAboutSlugRef.current = newSlug
            setActiveAboutSlug(newSlug)
            // Replace (not push) so scrolling doesn't spam the history
            // stack; native API so nothing remounts (#275).
            window.history.replaceState(null, "", aboutPath(journalId, newSlug))
          }
        }
      },
      {
        rootMargin: "-150px 0px -60% 0px", // Account for sticky headers
        threshold: [0, 0.25, 0.5, 0.75, 1],
      }
    )

    ABOUT_METADATA.forEach(({ slug }) => {
      const el = document.getElementById(`about-${slug}`)
      if (el) observer.observe(el)
    })

    return () => observer.disconnect()
  }, [activeTab, journalId, isReady])

  // Back/forward between pill-pushed entries: the URL changes but no
  // navigation happens, so scroll to the section it names ourselves.
  useEffect(() => {
    if (activeTab !== "about") return
    const onPopState = () => {
      const path = window.location.pathname.replace(/\/+$/, "")
      const match = path.match(/\/about-journal\/([^/]+)$/)
      const raw = match ? decodeURIComponent(match[1]) : null
      const slug = raw && ABOUT_METADATA.some((m) => m.slug === raw) ? raw : null
      activeAboutSlugRef.current = slug
      setActiveAboutSlug(slug)
      if (slug) {
        scrollToAboutSection(slug, isProgrammaticScroll, scrollResetTimerRef)
      } else {
        // Back to the slug-less entry (/journals/{id} or /about-journal).
        window.scrollTo({ top: 0, behavior: "smooth" })
      }
    }
    window.addEventListener("popstate", onPopState)
    return () => window.removeEventListener("popstate", onPopState)
  }, [activeTab])

  const handleAboutPillClick = (slug: string) => {
    activeAboutSlugRef.current = slug
    setActiveAboutSlug(slug)
    window.history.pushState(null, "", aboutPath(journalId, slug))
    scrollToAboutSection(slug, isProgrammaticScroll, scrollResetTimerRef)
  }

  return {
    activeAboutSlug,
    setActiveAboutSlug,
    handleAboutPillClick,
  }
}

function aboutPath(journalId: string, slug: string): string {
  return `/journals/${journalId}/about-journal/${slug}`
}

/**
 * Smooth-scroll to an About subsection below the sticky navbar + pills,
 * holding the scroll-spy off until the scroll has had time to finish (#150).
 */
function scrollToAboutSection(
  slug: string,
  isProgrammaticScroll: RefObject<boolean>,
  scrollResetTimerRef: RefObject<ReturnType<typeof setTimeout> | undefined>,
): void {
  const el = document.getElementById(`about-${slug}`)
  if (!el) return
  isProgrammaticScroll.current = true
  const yOffset = -140
  const y = el.getBoundingClientRect().top + window.scrollY + yOffset
  window.scrollTo({ top: y, behavior: "smooth" })

  if (scrollResetTimerRef.current) clearTimeout(scrollResetTimerRef.current)
  scrollResetTimerRef.current = setTimeout(() => {
    isProgrammaticScroll.current = false
    scrollResetTimerRef.current = undefined
  }, 1000)
}
