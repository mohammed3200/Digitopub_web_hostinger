import Link from "next/link"
import { CreditCard, ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"
import { sanitizeRichContent } from "@/src/features/journals/utils/sanitize-html"
import { formatCurrency } from "@/src/features/journals/utils/format-currency"

export interface PublicationFeesCardProps {
  publicationFeeDefault?: number | string | null
  submissionFeeDefault?: number | string | null
  ojsFees?: {
    html?: string | null
    publicationFee?: number | null
    submissionFee?: number | null
    currencyCode?: string | null
  } | null
  directUrl?: string | null
}

export function PublicationFeesCard({
  publicationFeeDefault = 0,
  submissionFeeDefault = 0,
  ojsFees,
  directUrl,
}: PublicationFeesCardProps) {
  const ojsHtml = ojsFees?.html ?? null
  const ojsPubFee = ojsFees?.publicationFee ?? null
  const ojsSubFee = ojsFees?.submissionFee ?? null

  // Prefer positive OJS values, otherwise use local cache
  const publicationFee =
    ojsPubFee && ojsPubFee > 0 ? ojsPubFee : Number(publicationFeeDefault ?? 0)
  const submissionFee =
    ojsSubFee && ojsSubFee > 0 ? ojsSubFee : Number(submissionFeeDefault ?? 0)
  const currency = (ojsFees?.currencyCode || "USD").toUpperCase()

  const safeOjsHtml = ojsHtml ? sanitizeRichContent(ojsHtml) : ""
  const hasRichContent = safeOjsHtml.length > 0
  const anyStructuredFee = publicationFee > 0 || submissionFee > 0

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-6 sm:p-8 shadow-sm">
      <div className="flex items-center gap-3 mb-6">
        <div className="p-2.5 rounded-lg bg-primary/10">
          <CreditCard className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="text-xl font-bold">Publication Fees</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Sourced directly from the journal settings on SubmitManager
          </p>
        </div>
      </div>

      {hasRichContent ? (
        <div
          className="prose prose-sm dark:prose-invert max-w-none prose-p:leading-relaxed prose-headings:font-bold prose-a:text-primary prose-table:text-sm"
          dangerouslySetInnerHTML={{ __html: safeOjsHtml }}
        />
      ) : anyStructuredFee ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {publicationFee > 0 && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80 mb-2">
                Publication Fee
              </p>
              <p className="text-3xl font-extrabold tracking-tight">
                {formatCurrency(publicationFee, currency)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Charged on acceptance. Covers peer-review, copyediting, typesetting, DOI, and
                long-term open-access hosting.
              </p>
            </div>
          )}
          {submissionFee > 0 && (
            <div className="rounded-xl border border-border/60 bg-muted/30 p-5">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/80 mb-2">
                Submission Fee
              </p>
              <p className="text-3xl font-extrabold tracking-tight">
                {formatCurrency(submissionFee, currency)}
              </p>
              <p className="mt-2 text-xs text-muted-foreground leading-relaxed">
                Charged at submission. Covers initial editorial handling and plagiarism
                screening.
              </p>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 bg-muted/30 p-5">
          <p className="text-sm font-semibold">Fee details are published on SubmitManager.</p>
          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
            The authoritative fee schedule lives on the journal&rsquo;s SubmitManager page. Open
            the journal website to view current charges.
          </p>
          {directUrl && (
            <Button asChild size="sm" variant="outline" className="mt-3 rounded-full">
              <Link href={directUrl}>
                Open SubmitManager
                <ExternalLink className="ml-1.5 h-3 w-3" />
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
