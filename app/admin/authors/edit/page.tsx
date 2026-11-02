"use client"

import { Suspense } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { PageHeader } from "@/components/ui/page-header"
import { PersonEditForm } from "@/src/features/author-profile/components/person-edit-form"
import {
  useAdminPerson,
  useAdminPersonPreview,
  useAdminPersonSave,
} from "@/src/features/author-profile/api/use-author-profile"

function EditAuthor() {
  const email = useSearchParams().get("email")
  const query = useAdminPerson(email)
  const preview = useAdminPersonPreview()
  const save = useAdminPersonSave()

  if (!email) return <p className="text-sm text-muted-foreground">No author selected.</p>
  if (query.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (query.isError || !query.data) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {query.error instanceof Error ? query.error.message : "Could not load this author."}
      </p>
    )
  }

  return (
    <PersonEditForm
      key={query.data.before.email}
      current={query.data}
      allowOrcid
      onPreview={(c) => preview.mutateAsync({ matchEmail: email, ...c })}
      onSave={(c) => save.mutateAsync({ matchEmail: email, ...c })}
    />
  )
}

export default function EditAuthorPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild aria-label="Back to authors">
          <Link href="/admin/authors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <PageHeader title="Edit author" subtitle="Changes apply to the OJS account and every article byline" />
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
        <EditAuthor />
      </Suspense>
    </div>
  )
}
