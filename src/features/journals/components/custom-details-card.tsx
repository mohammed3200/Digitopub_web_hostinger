"use client"

import { useRef, useState } from "react"
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  CUSTOM_DETAIL_LABEL_MAX,
  CUSTOM_DETAIL_VALUE_MAX,
  MAX_CUSTOM_DETAILS,
  customDetailsSchema,
  type CustomDetail,
} from "../custom-details"
import { useUpdateCustomDetails } from "../api/use-specializations"

interface Row extends CustomDetail {
  key: number
}

/** #281: edits the custom label/value pairs shown in the public "Journal Details" card. */
export function CustomDetailsCard({ journalId, saved }: { journalId: string; saved: CustomDetail[] }) {
  const save = useUpdateCustomDetails()
  const nextKey = useRef(saved.length)
  const [draft, setDraft] = useState<Row[] | null>(null)
  const rows: Row[] = draft ?? saved.map((d, i) => ({ ...d, key: i }))

  const parsed = customDetailsSchema.safeParse(rows.map(({ label, value }) => ({ label, value })))
  const error = parsed.success ? null : parsed.error.issues[0]?.message ?? "Check the fields"
  const changed = parsed.success
    ? JSON.stringify(parsed.data) !== JSON.stringify(saved)
    : draft !== null

  const update = (fn: (rows: Row[]) => Row[]) => setDraft(fn(rows))
  const setField = (index: number, field: keyof CustomDetail, value: string) =>
    update((r) => r.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  const move = (index: number, by: -1 | 1) =>
    update((r) => {
      const next = [...r]
      ;[next[index], next[index + by]] = [next[index + by], next[index]]
      return next
    })

  const handleSave = () => {
    if (!parsed.success) return
    save.mutate({ journalId, details: parsed.data }, { onSuccess: () => setDraft(null) })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Journal details: custom fields</CardTitle>
        <CardDescription>
          Extra fields shown in the &quot;Journal Details&quot; card on the public journal page, after ISSN, Publisher and
          Frequency (those come from OJS). A value that is a full web address (https://…) is shown as a link.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No custom fields yet.</p>}

        {rows.map((row, index) => (
          <div key={row.key} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
            <div className="space-y-1.5">
              <Label htmlFor={`cd-label-${row.key}`}>Label</Label>
              <Input
                id={`cd-label-${row.key}`}
                value={row.label}
                maxLength={CUSTOM_DETAIL_LABEL_MAX}
                placeholder="e.g. Indexed in"
                onChange={(e) => setField(index, "label", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`cd-value-${row.key}`}>Value</Label>
              <Input
                id={`cd-value-${row.key}`}
                value={row.value}
                maxLength={CUSTOM_DETAIL_VALUE_MAX}
                placeholder="e.g. Scopus, DOAJ"
                onChange={(e) => setField(index, "value", e.target.value)}
              />
            </div>
            <div className="flex gap-1">
              <Button type="button" variant="outline" size="icon" aria-label={`Move field ${index + 1} up`}
                disabled={index === 0} onClick={() => move(index, -1)}>
                <ArrowUp className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" aria-label={`Move field ${index + 1} down`}
                disabled={index === rows.length - 1} onClick={() => move(index, 1)}>
                <ArrowDown className="h-4 w-4" />
              </Button>
              <Button type="button" variant="outline" size="icon" aria-label={`Remove field ${index + 1}`}
                onClick={() => update((r) => r.filter((_, i) => i !== index))}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          </div>
        ))}

        {error && draft !== null && (
          <p className="text-sm text-destructive" role="alert">{error}</p>
        )}

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            variant="outline"
            disabled={rows.length >= MAX_CUSTOM_DETAILS}
            onClick={() => {
              // Saved rows use their index as key, so new keys start past the longest list seen.
              nextKey.current = Math.max(nextKey.current, rows.length)
              update((r) => [...r, { key: nextKey.current++, label: "", value: "" }])
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Add field
          </Button>
          <Button type="button" onClick={handleSave} disabled={!changed || !parsed.success || save.isPending}>
            {save.isPending ? "Saving…" : "Save custom fields"}
          </Button>
          {draft !== null && (
            <Button type="button" variant="ghost" onClick={() => setDraft(null)} disabled={save.isPending}>
              Discard changes
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          Up to {MAX_CUSTOM_DETAILS} fields. Empty rows are ignored when saving.
        </p>
      </CardContent>
    </Card>
  )
}
