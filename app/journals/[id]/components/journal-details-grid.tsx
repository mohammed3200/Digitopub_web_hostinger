import { FileText, Database, Globe, Building, Calendar } from "lucide-react"
import { type Journal } from "@/src/features/journals"

export interface JournalDetailsGridProps {
  journal: Journal
}

export function JournalDetailsGrid({ journal }: JournalDetailsGridProps) {
  const details = ([
    journal.issn ? { label: "ISSN (Print)", value: journal.issn, icon: Database } : null,
    journal.e_issn ? { label: "ISSN (Online)", value: journal.e_issn, icon: Globe } : null,
    journal.publisher ? { label: "Publisher", value: journal.publisher, icon: Building } : null,
    journal.frequency ? { label: "Frequency", value: journal.frequency, icon: Calendar } : null,
  ] as const).filter((item): item is NonNullable<typeof item> => item !== null)

  return (
    <div id="about-journal-details" className="pt-2 border-t border-border/30 scroll-mt-32">
      <div className="rounded-2xl border border-border/60 bg-card p-6 sm:p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-6">
          <div className="p-2.5 rounded-lg bg-primary/10">
            <FileText className="h-5 w-5 text-primary" />
          </div>
          <h2 className="text-xl font-bold">Journal Details</h2>
        </div>
        <div className="grid grid-cols-1 gap-y-5 text-sm sm:grid-cols-2 sm:gap-x-8">
          {details.map((item) => (
            <div
              key={item.label}
              className="flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/40 hover:border-border/80 transition-colors"
            >
              <div className="p-2 rounded-md bg-background shadow-xs mt-0.5 border border-border/50">
                <item.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden py-0.5">
                <span className="block text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                  {item.label}
                </span>
                <span className="block font-medium text-foreground truncate text-sm">
                  {item.value}
                </span>
              </div>
            </div>
          ))}
          {details.length === 0 && (
            <p className="col-span-2 text-sm text-muted-foreground italic">
              Additional journal details are currently being updated.
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
