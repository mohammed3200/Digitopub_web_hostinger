import { Info, Calendar, Target, Telescope, BookOpen } from "lucide-react"
import CollapsibleContent from "@/components/ui/collapsible-content"
import { type Journal } from "@/src/features/journals"

export interface AimsScopeSectionProps {
  journal: Journal
  safeAims: string | null
  safeScope: string | null
  safeAimsAndScopeCombined: string | null
}

export function AimsScopeSection({
  journal,
  safeAims,
  safeScope,
  safeAimsAndScopeCombined,
}: AimsScopeSectionProps) {
  return (
    <div id="about-aims-scope" className="space-y-8 scroll-mt-32">
      {/* Journal Overview */}
      <div className="rounded-2xl border border-border/60 bg-card p-6 sm:p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-lg bg-primary/10">
            <Info className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-xl font-bold">Journal Overview</h2>
        </div>
        <CollapsibleContent maxHeight={300} className="prose prose-slate max-w-none dark:prose-invert">
          {journal.description ||
            "Journal description is currently being updated. Please check back soon for more information about this publication."}
        </CollapsibleContent>

        {/* Publication Frequency — only if data exists */}
        {journal.frequency && (
          <div className="mt-8">
            <div className="rounded-xl border bg-muted/40 p-5">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <Calendar className="h-4 w-4 text-primary" />
                </div>
                <h4 className="font-semibold text-sm">Publication Frequency</h4>
              </div>
              <p className="text-muted-foreground text-sm">{journal.frequency}</p>
            </div>
          </div>
        )}
      </div>

      {/* Aims & Scope — split into two branded cards when OJS content has
          distinct headings; fall back to a single combined card otherwise. */}
      {safeAims && safeScope ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="group relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/[0.03] p-6 sm:p-7 shadow-sm transition hover:shadow-md hover:border-primary/30">
            <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/5 blur-2xl transition-colors group-hover:bg-primary/10" />
            <div className="relative flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-primary/10 ring-1 ring-primary/20">
                <Target className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">Purpose</p>
                <h2 className="text-lg font-bold leading-tight">Aims of the Journal</h2>
              </div>
            </div>
            <CollapsibleContent maxHeight={260} className="prose prose-slate max-w-none dark:prose-invert relative">
              <div
                className="text-[15px] leading-relaxed text-foreground"
                dangerouslySetInnerHTML={{ __html: safeAims }}
              />
            </CollapsibleContent>
          </div>

          <div className="group relative overflow-hidden rounded-2xl border border-border/60 bg-gradient-to-br from-card via-card to-primary/[0.03] p-6 sm:p-7 shadow-sm transition hover:shadow-md hover:border-primary/30">
            <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-primary/5 blur-2xl transition-colors group-hover:bg-primary/10" />
            <div className="relative flex items-center gap-3 mb-5">
              <div className="p-2.5 rounded-xl bg-primary/10 ring-1 ring-primary/20">
                <Telescope className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80">Coverage</p>
                <h2 className="text-lg font-bold leading-tight">Scope of the Journal</h2>
              </div>
            </div>
            <CollapsibleContent maxHeight={260} className="prose prose-slate max-w-none dark:prose-invert relative">
              <div
                className="text-[15px] leading-relaxed text-foreground"
                dangerouslySetInnerHTML={{ __html: safeScope }}
              />
            </CollapsibleContent>
          </div>
        </div>
      ) : safeAimsAndScopeCombined ? (
        <div className="rounded-2xl border border-border/60 bg-card p-6 sm:p-8 shadow-sm">
          <div className="flex items-center gap-3 mb-6">
            <div className="p-2.5 rounded-lg bg-primary/10">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <h2 className="text-xl font-bold">Aims &amp; Scope</h2>
          </div>
          <CollapsibleContent maxHeight={300} className="prose prose-slate max-w-none dark:prose-invert">
            <div
              className="text-base leading-relaxed text-foreground"
              dangerouslySetInnerHTML={{ __html: safeAimsAndScopeCombined }}
            />
          </CollapsibleContent>
        </div>
      ) : null}
    </div>
  )
}
