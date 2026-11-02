"use client"

import Link from "next/link"
import { Logo } from "@/components/logo"
import { Search, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { LanguageSwitcher } from "@/components/language-switcher"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { useSearchStore } from "@/src/features/search"
import { useIdentity } from "@/src/hooks/use-identity"
import { signOutOrcid } from "@/src/features/auth/utils/sign-out-orcid"

export function Navbar() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const { open } = useSearchStore()
  const router = useRouter()
  const queryClient = useQueryClient()
  // Public (ORCID) identity only: the admin session is not queried here, so
  // anonymous page views make no 401 call and the two identities stay apart (#260).
  const { data: identity, orcidAvailable } = useIdentity()
  const signedIn = identity?.authenticated === true

  const handleSignOut = async () => {
    setSigningOut(true)
    const ok = await signOutOrcid()
    setSigningOut(false)
    if (!ok) {
      toast.error("Could not sign you out. Please try again.")
      return
    }
    await queryClient.invalidateQueries()
    router.refresh()
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo width={180} height={60} className="h-14 w-auto" />
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-6">
          <Link href="/" className="text-sm font-medium transition-colors hover:text-primary">
            Home
          </Link>
          <Link href="/about" className="text-sm font-medium transition-colors hover:text-primary">
            About
          </Link>
          <Link href="/journals" className="text-sm font-medium transition-colors hover:text-primary">
            Journals
          </Link>
          <Link href="/solutions" className="text-sm font-medium transition-colors hover:text-primary">
            Solutions
          </Link>
          <Link href="/submit-manager" className="text-sm font-medium transition-colors hover:text-primary">
            Submit Manager
          </Link>
          <Link href="/help" className="text-sm font-medium transition-colors hover:text-primary">
            Help
          </Link>
          <Link href="/contact" className="text-sm font-medium transition-colors hover:text-primary">
            Contact
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          {/* Search trigger pill — desktop */}
          <button
            id="navbar-search-trigger"
            type="button"
            onClick={open}
            aria-label="Open search (Ctrl+K)"
            className="hidden lg:flex items-center gap-2 rounded-full border border-border bg-muted/50 px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Search className="h-3.5 w-3.5" />
            <span>Search…</span>
            <span className="ml-2 hidden items-center gap-1 xl:inline-flex whitespace-nowrap">
              <kbd className="inline-flex h-5 items-center justify-center rounded border border-border bg-muted/60 px-1.5 font-sans text-[11px] font-semibold text-muted-foreground shadow-sm">
                Ctrl
              </kbd>
              <span className="font-sans text-[10px] font-medium text-muted-foreground">+</span>
              <kbd className="inline-flex h-5 items-center justify-center rounded border border-border bg-muted/60 px-1.5 font-sans text-[11px] font-semibold text-muted-foreground shadow-sm">
                K
              </kbd>
            </span>
          </button>

          {/* Search icon — compact, for md screens */}
          <button
            type="button"
            onClick={open}
            aria-label="Open search"
            className="hidden md:flex lg:hidden items-center justify-center rounded-full border border-border bg-muted/50 p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Search className="h-4 w-4" />
          </button>

          <div className="hidden lg:block">
            <LanguageSwitcher />
          </div>
          <ThemeToggle />
          <div className="hidden md:flex items-center gap-2">
            {signedIn ? (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link href="/account/profile">My account</Link>
                </Button>
                <Button size="sm" variant="ghost" onClick={handleSignOut} disabled={signingOut}>
                  Sign out
                </Button>
              </>
            ) : (
              <>
                {orcidAvailable && (
                  <Button size="sm" variant="ghost" asChild>
                    <Link href="/account/profile">Sign in</Link>
                  </Button>
                )}
                <Button size="sm" asChild>
                  <Link href="/register">Register</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setIsMenuOpen(!isMenuOpen)}>
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="border-t md:hidden">
          <nav className="container mx-auto flex flex-col gap-4 px-4 py-4">
            {/* Mobile search trigger */}
            <button
              type="button"
              onClick={() => { open(); setIsMenuOpen(false) }}
              className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted"
            >
              <Search className="h-4 w-4" />
              <span>Search journals, solutions, FAQs…</span>
            </button>

            <Link href="/" className="text-sm font-medium transition-colors hover:text-primary" onClick={() => setIsMenuOpen(false)}>
              Home
            </Link>
            <Link href="/about" className="text-sm font-medium transition-colors hover:text-primary" onClick={() => setIsMenuOpen(false)}>
              About
            </Link>
            <Link href="/journals" className="text-sm font-medium transition-colors hover:text-primary" onClick={() => setIsMenuOpen(false)}>
              Journals
            </Link>
            <Link href="/solutions" className="text-sm font-medium transition-colors hover:text-primary" onClick={() => setIsMenuOpen(false)}>
              Solutions
            </Link>
            <Link href="/submit-manager" className="text-sm font-medium transition-colors hover:text-primary" onClick={() => setIsMenuOpen(false)}>
              Submit Manager
            </Link>
            <Link href="/help" className="text-sm font-medium transition-colors hover:text-primary" onClick={() => setIsMenuOpen(false)}>
              Help
            </Link>
            <Link href="/contact" className="text-sm font-medium transition-colors hover:text-primary" onClick={() => setIsMenuOpen(false)}>
              Contact
            </Link>
            <div className="flex gap-2 pt-2">
              {signedIn ? (
                <>
                  <Button size="sm" variant="outline" className="flex-1" asChild>
                    <Link href="/account/profile" onClick={() => setIsMenuOpen(false)}>My account</Link>
                  </Button>
                  <Button size="sm" variant="ghost" className="flex-1" onClick={handleSignOut} disabled={signingOut}>
                    Sign out
                  </Button>
                </>
              ) : (
                <>
                  {orcidAvailable && (
                    <Button size="sm" variant="outline" className="flex-1" asChild>
                      <Link href="/account/profile" onClick={() => setIsMenuOpen(false)}>Sign in</Link>
                    </Button>
                  )}
                  <Button size="sm" className="flex-1" asChild>
                    <Link href="/register" onClick={() => setIsMenuOpen(false)}>Register</Link>
                  </Button>
                </>
              )}
            </div>
          </nav>
        </div>
      )}
    </header>
  )
}
