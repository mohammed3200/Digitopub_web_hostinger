import { FileText, Database, Globe, Building, Calendar, Info, type LucideIcon } from "lucide-react"
import { type Journal } from "@/src/features/journals"
import { parseCustomDetails } from "@/src/features/journals/custom-details"
import { cn } from "@/src/lib/utils"

export interface JournalDetailsGridProps {
  journal: Journal
}

type DetailItem = { label: string; icon: LucideIcon } & (
  | { value: string; html?: never }
  /** #281/#288: manager-defined fields hold rich text, sanitized by GET /api/journals/:id. */
  | { html: string; value?: never }
)

/** More than one block (paragraphs, list, heading) gets the full card width. */
function isWide(html: string): boolean {
  return /<(ul|ol|h4)[\s>]/.test(html) || (html.match(/<p[\s>]/g)?.length ?? 0) > 1
}

/**
 * Typography for the sanitized subset (p, br, strong, em, h4, ul, ol, li, a),
 * compact to match the card. Every link opens a new tab (the sanitizer forces
 * target="_blank"), so every link gets the ↗ marker.
 */
const RICH_VALUE = cn(
  "font-medium text-foreground text-sm break-words",
  "[&_p]:my-0 [&_p+p]:mt-1.5 [&_p+h4]:mt-2.5 [&_ul+h4]:mt-2.5 [&_ol+h4]:mt-2.5",
  "[&_h4]:mb-0.5 [&_h4]:text-xs [&_h4]:font-semibold [&_h4]:uppercase [&_h4]:tracking-wider [&_h4]:text-muted-foreground",
  "[&_strong]:font-semibold [&_em]:italic",
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5",
  "[&_a]:text-primary [&_a]:underline-offset-2 [&_a:hover]:underline",
  "[&_a]:after:ml-0.5 [&_a]:after:text-xs [&_a]:after:content-['↗']",
)

export function JournalDetailsGrid({ journal }: JournalDetailsGridProps) {
  const builtIn: (DetailItem | null)[] = [
    journal.issn ? { label: "ISSN (Print)", value: journal.issn, icon: Database } : null,
    journal.e_issn ? { label: "ISSN (Online)", value: journal.e_issn, icon: Globe } : null,
    journal.publisher ? { label: "Publisher", value: journal.publisher, icon: Building } : null,
    journal.frequency ? { label: "Frequency", value: journal.frequency, icon: Calendar } : null,
  ]
  const details: DetailItem[] = [
    ...builtIn.filter((item): item is DetailItem => item !== null),
    ...parseCustomDetails(journal.custom_details).map((d) => ({ ...d, icon: Info })),
  ]

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
          {details.map((item, i) => (
            <div
              key={`${item.label}-${i}`}
              className={cn(
                "flex items-start gap-3 p-3 rounded-lg bg-muted/30 border border-border/40 hover:border-border/80 transition-colors",
                item.html !== undefined && isWide(item.html) && "sm:col-span-2",
              )}
            >
              <div className="p-2 rounded-md bg-background shadow-xs mt-0.5 border border-border/50">
                <item.icon className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden py-0.5">
                <span className="block text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                  {item.label}
                </span>
                {item.html !== undefined ? (
                  // Safe: the API sanitizes custom detail HTML on every read
                  // (src/features/journals/server/custom-details-html.ts).
                  <div className={RICH_VALUE} dangerouslySetInnerHTML={{ __html: item.html }} />
                ) : (
                  <span className="block font-medium text-foreground truncate text-sm">{item.value}</span>
                )}
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
