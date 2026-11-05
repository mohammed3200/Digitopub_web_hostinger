import { OjsImage } from "@/src/features/ojs/components/ojs-image"
import { Badge } from "@/components/ui/badge"
import {
  Globe,
  Database,
  Building,
  Calendar,
  Send,
  ArrowRight,
} from "lucide-react"
import { type Journal } from "@/src/features/journals"
import { SubmitManuscriptButton } from "./submit-manuscript-button"

export interface JournalHeroProps {
  journal: Journal
  submissionUrl?: string | null
}

export function JournalHero({ journal, submissionUrl }: JournalHeroProps) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 text-white">
      {/* Animated Background Pattern */}
      <div className="absolute inset-0 z-0">
        {journal.cover_image_url && (
          <OjsImage
            src={journal.cover_image_url}
            alt=""
            fill
            className="object-cover opacity-5 blur-2xl"
            priority
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-slate-950 via-slate-950/95 to-slate-950/90" />
        {/* Subtle Grid Pattern */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      <div className="container relative z-10 mx-auto px-4 md:px-6 py-12 md:py-16">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[240px_minmax(0,1fr)] md:items-start lg:gap-16">
          {/* Cover Image */}
          <div className="mx-auto w-40 md:mx-0 md:w-48 lg:w-56 flex-shrink-0">
            <div className="relative group">
              <div className="absolute -inset-1 bg-gradient-to-br from-primary/30 via-primary/10 to-transparent rounded-xl blur-lg opacity-50 group-hover:opacity-75 transition-opacity duration-500" />
              <div className="relative rounded-xl overflow-hidden shadow-2xl shadow-black/30 ring-1 ring-white/10">
                <OjsImage
                  src={journal.cover_image_url || "/images/logodigitopub.png"}
                  alt={journal.title}
                  width={224}
                  height={312}
                  className="h-auto w-full object-cover"
                  priority
                />
              </div>
            </div>
          </div>

          {/* Title + Metadata + Actions */}
          <div className="space-y-6">
            {/* Badges */}
            <div className="flex flex-wrap gap-2.5">
              {journal.field && (
                <Badge
                  variant="secondary"
                  className="bg-white/10 text-white border-white/20 backdrop-blur-sm px-3.5 py-1.5 text-xs font-semibold"
                >
                  <Globe className="mr-1.5 h-3 w-3" />
                  {journal.field}
                </Badge>
              )}
              <Badge
                variant="outline"
                className="border-white/20 text-white/80 bg-white/5 backdrop-blur-sm px-3.5 py-1.5 text-xs font-medium"
              >
                <Database className="mr-1.5 h-3 w-3" />
                {journal.issn || journal.e_issn || "ISSN Coming Soon"}
              </Badge>
              <Badge
                variant="outline"
                className="border-white/20 text-white/80 bg-white/5 backdrop-blur-sm px-3.5 py-1.5 text-xs font-medium"
              >
                <Globe className="mr-1.5 h-3 w-3" />
                Open Access
              </Badge>
            </div>

            {/* Title */}
            <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-balance leading-tight">
              {journal.title}
            </h1>

            {/* Metadata Row */}
            <div className="flex flex-wrap gap-x-8 gap-y-3 text-sm text-slate-300">
              {journal.publisher && (
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-white/5">
                    <Building className="h-4 w-4 text-primary/80" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Publisher</span>
                    <span className="font-medium text-slate-200">{journal.publisher}</span>
                  </div>
                </div>
              )}
              {journal.frequency && (
                <div className="flex items-center gap-2">
                  <div className="p-1.5 rounded-md bg-white/5">
                    <Calendar className="h-4 w-4 text-primary/80" />
                  </div>
                  <div>
                    <span className="text-xs text-slate-500 block">Frequency</span>
                    <span className="font-medium text-slate-200">{journal.frequency}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3 pt-2">
              <SubmitManuscriptButton
                submissionUrl={submissionUrl}
                className="rounded-lg px-6 shadow-lg shadow-primary/20 hover:shadow-xl hover:shadow-primary/30"
              >
                <span className="flex items-center gap-2">
                  <Send className="h-4 w-4" />
                  <span>Submit Manuscript</span>
                </span>
                <ArrowRight className="h-4 w-4 ml-1" />
              </SubmitManuscriptButton>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
