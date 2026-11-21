"use client"

import { useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleDashed, Clock, Link2Off, RefreshCw, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  useGetJournalSpecialization,
  useGetSpecializations,
  useRetrySpecializationSync,
  useSetJournalSpecialization,
  useUpdateInvitationScope,
} from "@/src/features/journals/api/use-specializations"
import type { SpecializationSyncStatus } from "@/src/features/journals/schemas/specialization-schema"
import { CustomDetailsCard } from "@/src/features/journals/components/custom-details-card"

function formatDateTime(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString() : "—"
}

function SyncPanel({
  sync,
  onRetry,
  retrying,
}: {
  sync: SpecializationSyncStatus
  onRetry: () => void
  retrying: boolean
}) {
  const base = "rounded-lg border p-4 space-y-1 text-sm"
  switch (sync.state) {
    case "synced":
      return (
        <div className={`${base} border-green-500/30 bg-green-500/10`} role="status">
          <p className="flex items-center gap-2 font-medium text-green-700 dark:text-green-400">
            <CheckCircle2 className="h-4 w-4" /> Synced to OJS
          </p>
          <p className="text-muted-foreground">Last synced {formatDateTime(sync.completed_at)}</p>
        </div>
      )
    case "pending":
      return (
        <div className={`${base} border-amber-500/30 bg-amber-500/10`} role="status">
          <p className="flex items-center gap-2 font-medium text-amber-700 dark:text-amber-400">
            <Clock className="h-4 w-4" /> Pending: will retry automatically
          </p>
          <p className="text-muted-foreground">Next attempt {formatDateTime(sync.next_attempt_at)} (attempts so far: {sync.attempts})</p>
          {sync.last_error && <p className="text-muted-foreground">Last error: {sync.last_error}</p>}
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry} disabled={retrying}>
            <RefreshCw className={`mr-2 h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Retrying…" : "Retry now"}
          </Button>
        </div>
      )
    case "failed":
      return (
        <div className={`${base} border-destructive/30 bg-destructive/10`} role="alert">
          <p className="flex items-center gap-2 font-medium text-destructive">
            <XCircle className="h-4 w-4" /> Failed to sync to OJS
          </p>
          {sync.last_error && <p className="text-muted-foreground">Last error: {sync.last_error}</p>}
          <p className="text-muted-foreground">Attempts: {sync.attempts}</p>
          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onRetry} disabled={retrying}>
            <RefreshCw className={`mr-2 h-4 w-4 ${retrying ? "animate-spin" : ""}`} />
            {retrying ? "Retrying…" : "Retry sync"}
          </Button>
        </div>
      )
    case "not_linked":
      return (
        <div className={`${base} border-border bg-muted/50`} role="status">
          <p className="flex items-center gap-2 font-medium text-muted-foreground">
            <Link2Off className="h-4 w-4" /> Not linked to OJS
          </p>
          <p className="text-muted-foreground">
            This journal has no OJS id, so the value is saved in Digitopub only.
          </p>
        </div>
      )
    default:
      return (
        <div className={`${base} border-border bg-muted/50`} role="status">
          <p className="flex items-center gap-2 font-medium text-muted-foreground">
            <CircleDashed className="h-4 w-4" /> Never synced
          </p>
          <p className="text-muted-foreground">No specialization change has been sent to OJS for this journal yet.</p>
        </div>
      )
  }
}

export default function EditJournalPage() {
  const params = useParams<{ id: string }>()
  const id = params.id

  const journalQuery = useGetJournalSpecialization(id)
  const specsQuery = useGetSpecializations()
  const setSpec = useSetJournalSpecialization()
  const retry = useRetrySpecializationSync()

  const [selected, setSelected] = useState<string | null>(null)

  const journal = journalQuery.data
  const activeNames = (specsQuery.data ?? []).map((s) => s.name)
  const current = journal?.field ?? ""
  const value = selected ?? current
  const currentIsActive = activeNames.includes(current)
  const changed = selected !== null && selected !== current
  const sync = journal?.sync

  const saveScope = useUpdateInvitationScope()
  const [scopeDraft, setScopeDraft] = useState<string | null>(null)
  const scopeValue = scopeDraft ?? journal?.invitation_scope ?? ""
  const scopeChanged = scopeDraft !== null && scopeDraft.trim() !== (journal?.invitation_scope ?? "")
  const shortName = journal?.ojs_path?.toUpperCase() ?? ""

  const handleSave = () => {
    if (!journal || !changed || !selected) return
    setSpec.mutate({ journalId: journal.journal_id, name: selected }, { onSuccess: () => setSelected(null) })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button asChild variant="outline" size="icon">
          <Link href="/admin/journals" aria-label="Back to journals">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Edit journal</h1>
          <p className="text-muted-foreground mt-1">
            <Link href="/admin/journals" className="underline underline-offset-2">Back to journals</Link>
          </p>
        </div>
      </div>

      {journalQuery.isLoading && <Skeleton className="h-64 w-full" />}

      {journalQuery.isError && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-4">
          <p className="text-sm text-destructive">Error loading journal: {journalQuery.error.message}</p>
        </div>
      )}

      {journal && (
        <Card>
          <CardHeader>
            <CardTitle>{journal.title}</CardTitle>
            <CardDescription>
              Current specialization: <span className="font-medium text-foreground">{current || "—"}</span>
              {journal.ojs_path ? ` · OJS journal "${journal.ojs_path}"` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {specsQuery.isSuccess && !currentIsActive && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                <p>
                  The current value &quot;{current}&quot; is not in the active specialization list. Choose a valid specialization below.
                </p>
              </div>
            )}

            <div className="space-y-2 max-w-md">
              <Label htmlFor="specialization">Specialization</Label>
              <Select
                value={activeNames.includes(value) ? value : ""}
                onValueChange={setSelected}
                disabled={specsQuery.isLoading || activeNames.length === 0}
              >
                <SelectTrigger id="specialization">
                  <SelectValue
                    placeholder={
                      specsQuery.isLoading
                        ? "Loading…"
                        : activeNames.length === 0
                          ? "No active specializations"
                          : "Select specialization"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {activeNames.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {specsQuery.isError && (
                <p className="text-sm text-destructive">Could not load specializations: {specsQuery.error.message}</p>
              )}
              <p className="text-sm text-muted-foreground">
                <Link href="/admin/journals/specializations" className="underline underline-offset-2">
                  Manage list
                </Link>
              </p>
            </div>

            <div className="flex gap-4">
              <Button type="button" onClick={handleSave} disabled={!changed || setSpec.isPending}>
                {setSpec.isPending ? "Saving…" : "Save"}
              </Button>
              <Button type="button" variant="outline" asChild>
                <Link href="/admin/journals">Cancel</Link>
              </Button>
            </div>

            <div className="space-y-2">
              <h2 className="text-sm font-semibold">OJS sync status</h2>
              {sync && (
                <SyncPanel
                  sync={sync}
                  onRetry={() => retry.mutate(journal.journal_id)}
                  retrying={retry.isPending}
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {journal && (
        <Card>
          <CardHeader>
            <CardTitle>Alert invitation</CardTitle>
            <CardDescription>
              Describes the journal in the invitation email sent to imported contacts. It continues the sentence
              &quot;We are pleased to invite you to stay connected with the {journal.title}
              {shortName ? ` (${shortName})` : ""},&nbsp;…&quot;. Leave it empty to end the sentence after the journal name.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="invitation-scope">Journal description for invitations</Label>
              <Textarea
                id="invitation-scope"
                rows={3}
                maxLength={500}
                value={scopeValue}
                onChange={(e) => setScopeDraft(e.target.value)}
                placeholder="an international, peer-reviewed, open-access journal dedicated to advancing research and clinical practice in …"
              />
              <p className="text-sm text-muted-foreground">{scopeValue.length}/500 characters. Start in lower case, without a final full stop.</p>
            </div>
            <Button
              type="button"
              onClick={() =>
                saveScope.mutate({ journalId: journal.journal_id, scope: scopeValue }, { onSuccess: () => setScopeDraft(null) })
              }
              disabled={!scopeChanged || saveScope.isPending}
            >
              {saveScope.isPending ? "Saving…" : "Save invitation text"}
            </Button>
          </CardContent>
        </Card>
      )}

      {journal && <CustomDetailsCard journalId={journal.journal_id} saved={journal.custom_details ?? []} />}
    </div>
  )
}
