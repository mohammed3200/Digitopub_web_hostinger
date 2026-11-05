"use client"

import {
  BookOpen,
  FileText,
  Scale,
  Archive as ArchiveIcon,
  Newspaper as NewspaperIcon,
} from "lucide-react"

import {
  useGetJournal,
  useGetJournalStats,
  useJournalId,
  useGetJournalFees,
  useGetJournalAboutContent,
  useTabSync,
  useAboutScrollSpy,
  resolveOjsUrls,
  sanitizeContent,
  sanitizeRichContent,
} from "@/src/features/journals"
import { parseAimsAndScope } from "@/src/features/journals/utils/aims-scope-parser"

import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { JournalError } from "@/components/errors/error-states"
import { JournalNotFound } from "@/components/states/not-found-states"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { JournalDetailSkeleton } from "@/components/skeletons/journal-detail-skeleton"

import { CurrentIssueSection } from "@/app/journals/[id]/components/current-issue-section"
import { ArchiveSection } from "@/app/journals/[id]/components/archive-section"
import { JournalPoliciesSection } from "@/app/journals/[id]/components/journal-policies-section"
import { JournalHero } from "@/app/journals/[id]/components/journal-hero"
import { AboutTabContent } from "@/app/journals/[id]/components/about-tab-content"
import { AuthorGuidelinesTab } from "@/app/journals/[id]/components/author-guidelines-tab"
import { JournalSidebar } from "@/app/journals/[id]/components/journal-sidebar"
import { type JournalDetailTab, journalTabPath } from "@/app/journals/[id]/tab-config"

const TAB_TRIGGER_CLASSES =
  "rounded-none border-b-2 border-transparent px-3 sm:px-4 py-3 sm:py-4 text-xs sm:text-sm font-semibold text-muted-foreground whitespace-nowrap data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none"

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      <main className="flex-1 overflow-x-clip">{children}</main>
      <Footer />
    </div>
  )
}

export interface JournalDetailViewProps {
  /** Tab to show on first render. Defaults to "about" on the journal root route. */
  initialTab?: JournalDetailTab
  /**
   * When `initialTab === "policies"`, the policy sub-tab to open. The Policies
   * section pushes URL changes (`/journals/{id}/policies/{slug}`) on user
   * interaction; this prop seeds the initial selection from the URL.
   */
  initialPolicySlug?: string | null
  /**
   * When `initialTab === "about"`, the about sub-section to scroll to.
   */
  initialAboutSlug?: string | null
}

export function JournalDetailView({
  initialTab = "about",
  initialPolicySlug = null,
  initialAboutSlug = null,
}: JournalDetailViewProps = {}) {
  const id = useJournalId()

  const { data: journal, isLoading, error } = useGetJournal(id)
  const { data: stats } = useGetJournalStats(id)
  const { data: ojsFees } = useGetJournalFees(id)
  const { data: ojsAbout } = useGetJournalAboutContent(id)

  const { activeTab, handleTabChange } = useTabSync<JournalDetailTab>({
    initialTab,
    journalId: id,
    buildPath: journalTabPath,
  })

  const { activeAboutSlug, handleAboutPillClick } = useAboutScrollSpy({
    journalId: id,
    initialAboutSlug,
    activeTab,
    isReady: !isLoading && !!journal,
  })

  if (isLoading) {
    return (
      <PageShell>
        <JournalDetailSkeleton />
      </PageShell>
    )
  }

  if (error) {
    return (
      <PageShell>
        <JournalError message={error.message} />
      </PageShell>
    )
  }

  if (!journal) {
    return (
      <PageShell>
        <JournalNotFound />
      </PageShell>
    )
  }

  // Aims & Scope resolution:
  //   - When OJS has any content, trust its decision in full.
  //   - Only fall back to splitting the local structured aims_and_scope field
  //     when OJS returned nothing at all.
  const hasOjs = !!(ojsAbout && (ojsAbout.aims || ojsAbout.scope || ojsAbout.combined))
  const localParts = hasOjs ? null : parseAimsAndScope(journal.aims_and_scope)

  const chosenAims = hasOjs ? ojsAbout?.aims ?? null : localParts?.aims ?? null
  const chosenScope = hasOjs ? ojsAbout?.scope ?? null : localParts?.scope ?? null
  const chosenCombined = hasOjs ? ojsAbout?.combined ?? null : localParts?.combined ?? null

  const safeAims = chosenAims ? sanitizeRichContent(chosenAims) : null
  const safeScope = chosenScope ? sanitizeRichContent(chosenScope) : null
  const safeAimsAndScopeCombined = chosenCombined ? sanitizeRichContent(chosenCombined) : null
  const safeAuthorGuidelines = sanitizeContent(journal.author_guidelines)

  const ojsUrls = resolveOjsUrls(journal)

  return (
    <PageShell>
      {/* Hero Section */}
      <JournalHero
        journal={journal}
        submissionUrl={ojsUrls.submissionUrl}
      />

      {/* Content Section */}
      <section className="py-10 md:py-14 lg:py-16">
        <div className="container mx-auto px-4 md:px-6">
          <div className="grid grid-cols-1 gap-10 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-8 min-w-0">
              <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
                <TabsList className="inline-flex h-auto w-full justify-start gap-1 bg-transparent p-0 border-b border-border rounded-none overflow-x-auto">
                  <TabsTrigger value="about" className={TAB_TRIGGER_CLASSES}>
                    <BookOpen className="mr-2 h-4 w-4" />
                    About Journal
                  </TabsTrigger>
                  <TabsTrigger value="author" className={TAB_TRIGGER_CLASSES}>
                    <FileText className="mr-2 h-4 w-4" />
                    Author Guidelines
                  </TabsTrigger>
                  <TabsTrigger value="current" className={TAB_TRIGGER_CLASSES}>
                    <NewspaperIcon className="mr-2 h-4 w-4" />
                    Current Issue
                  </TabsTrigger>
                  <TabsTrigger value="archive" className={TAB_TRIGGER_CLASSES}>
                    <ArchiveIcon className="mr-2 h-4 w-4" />
                    Archive
                  </TabsTrigger>
                  <TabsTrigger value="policies" className={TAB_TRIGGER_CLASSES}>
                    <Scale className="mr-2 h-4 w-4" />
                    Policies
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="current" className="mt-8">
                  <CurrentIssueSection journalId={id} />
                </TabsContent>

                <TabsContent value="archive" className="mt-8">
                  <ArchiveSection journalId={id} />
                </TabsContent>

                <TabsContent value="policies" className="mt-8">
                  <JournalPoliciesSection
                    journalId={id}
                    initialPolicySlug={initialPolicySlug}
                  />
                </TabsContent>

                <TabsContent value="about" className="mt-8">
                  <AboutTabContent
                    journalId={id}
                    journal={journal}
                    activeAboutSlug={activeAboutSlug}
                    onPillClick={handleAboutPillClick}
                    safeAims={safeAims}
                    safeScope={safeScope}
                    safeAimsAndScopeCombined={safeAimsAndScopeCombined}
                  />
                </TabsContent>

                <TabsContent value="author" className="mt-8">
                  <AuthorGuidelinesTab
                    journal={journal}
                    ojsFees={ojsFees}
                    safeAuthorGuidelines={safeAuthorGuidelines}
                    submissionUrl={ojsUrls.submissionUrl}
                  />
                </TabsContent>
              </Tabs>
            </div>

            {/* Sidebar */}
            <JournalSidebar
              journalId={id}
              journal={journal}
              stats={stats}
              submissionUrl={ojsUrls.submissionUrl}
              onTabChange={handleTabChange}
            />
          </div>
        </div>
      </section>
    </PageShell>
  )
}