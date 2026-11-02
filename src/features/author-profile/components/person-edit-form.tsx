"use client"

import { useId, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PersonSaveResult, PersonUpdateSummary } from "../api/use-author-profile"

export interface PersonChanges {
    givenName?: string
    familyName?: string
    email?: string
    /** Admin only: empty input removes the iD (null). */
    orcid?: string | null
    /** Self-service only. */
    linkOrcid?: boolean
    /** Admin only: the differently named records under this email are one person. */
    samePerson?: boolean
}

interface PersonEditFormProps {
    current: PersonUpdateSummary
    allowOrcid: boolean
    /** Self-service: the signed-in ORCID iD (bare, no URL). */
    signedInOrcid?: string
    onPreview?: (changes: PersonChanges) => Promise<PersonUpdateSummary>
    onSave: (changes: PersonChanges) => Promise<PersonSaveResult>
}

/** "https://orcid.org/0000-…" and "0000-…" are the same iD; OJS stores the URL form. */
function bareOrcid(value: string | null | undefined): string {
    return (value ?? "").trim().replace(/^https?:\/\/(www\.)?orcid\.org\//i, "").toUpperCase()
}

function errorText(err: unknown): string {
    return err instanceof Error ? err.message : "Something went wrong. Please try again."
}

export function PersonEditForm({ current, allowOrcid, signedInOrcid, onPreview, onSave }: PersonEditFormProps) {
    const id = useId().replace(/:/g, "")
    const before = current.before
    const [givenName, setGivenName] = useState(before.givenName ?? "")
    const [familyName, setFamilyName] = useState(before.familyName ?? "")
    const [email, setEmail] = useState(before.email)
    const [orcid, setOrcid] = useState(before.orcid ?? "")
    const [linkOrcid, setLinkOrcid] = useState(false)
    const [samePerson, setSamePerson] = useState(false)
    // One email can cover several people (a submitter's address on co-authors' bylines).
    const severalNames = current.names.length > 1
    const [preview, setPreview] = useState<PersonUpdateSummary | null>(null)
    const [pending, setPending] = useState(false)
    const [sentTo, setSentTo] = useState<string | null>(null)

    const signedInUrl = signedInOrcid ? `https://orcid.org/${signedInOrcid}` : null
    const canLinkOrcid = !allowOrcid && !!signedInUrl && before.orcid !== signedInUrl

    const buildChanges = (): PersonChanges => {
        const changes: PersonChanges = {}
        if (givenName.trim() !== (before.givenName ?? "")) changes.givenName = givenName.trim()
        if (familyName.trim() !== (before.familyName ?? "")) changes.familyName = familyName.trim()
        if (email.trim() !== before.email) changes.email = email.trim()
        if (allowOrcid && bareOrcid(orcid) !== bareOrcid(before.orcid)) changes.orcid = orcid.trim() === "" ? null : orcid.trim()
        if (canLinkOrcid && linkOrcid) changes.linkOrcid = true
        if (allowOrcid && severalNames && samePerson && Object.keys(changes).length > 0) changes.samePerson = true
        return changes
    }

    const onPreviewClick = async () => {
        const changes = buildChanges()
        if (Object.keys(changes).length === 0) {
            toast.info("No changes to preview.")
            return
        }
        setPending(true)
        try {
            setPreview(await onPreview!(changes))
        } catch (err) {
            toast.error(errorText(err))
        } finally {
            setPending(false)
        }
    }

    const onSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const changes = buildChanges()
        if (Object.keys(changes).length === 0) {
            toast.info("Nothing has changed.")
            return
        }
        setPending(true)
        try {
            const result = await onSave(changes)
            setPreview(null)
            setLinkOrcid(false)
            setSentTo(result.confirmationSentTo)
            if (result.confirmationSentTo) {
                setEmail(before.email)
                toast.success(
                    `A confirmation link was sent to ${result.confirmationSentTo}; the email changes once it is opened.`,
                )
            } else {
                toast.success("Changes saved.")
            }
        } catch (err) {
            toast.error(errorText(err))
        } finally {
            setPending(false)
        }
    }

    return (
        <Card>
            <CardHeader>
                <CardTitle>Author details</CardTitle>
            </CardHeader>
            <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                    This author has an OJS account: {current.account ? "yes" : "no"} · {current.bylines} byline
                    {current.bylines !== 1 ? "s" : ""} on {current.publications} article
                    {current.publications !== 1 ? "s" : ""}
                </p>
                {severalNames && (
                    <div className="mb-4 rounded-md border border-amber-500/50 p-3 text-sm space-y-2" role="note">
                        <p>Records under this email use different names, so it may belong to more than one person:</p>
                        <ul className="list-disc pl-5">
                            {current.names.map((n) => (
                                <li key={n}>{n}</li>
                            ))}
                        </ul>
                        {allowOrcid ? (
                            <div className="flex items-center gap-2">
                                <Checkbox
                                    id={`${id}-same`}
                                    checked={samePerson}
                                    onCheckedChange={(v) => setSamePerson(v === true)}
                                />
                                <Label htmlFor={`${id}-same`}>These are all the same person; change every record</Label>
                            </div>
                        ) : (
                            <p>To change these records, contact the editorial office.</p>
                        )}
                    </div>
                )}
                <form onSubmit={onSubmit} className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor={`${id}-given`}>Given name</Label>
                        <Input id={`${id}-given`} value={givenName} onChange={(e) => setGivenName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor={`${id}-family`}>Family name</Label>
                        <Input id={`${id}-family`} value={familyName} onChange={(e) => setFamilyName(e.target.value)} />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor={`${id}-email`}>Email</Label>
                        <Input
                            id={`${id}-email`}
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                        />
                        <p className="text-xs text-muted-foreground">
                            A changed email is only applied after the new address opens a confirmation link.
                        </p>
                    </div>
                    {allowOrcid && (
                        <div className="space-y-2">
                            <Label htmlFor={`${id}-orcid`}>ORCID iD</Label>
                            <Input
                                id={`${id}-orcid`}
                                value={orcid}
                                placeholder="https://orcid.org/0000-0000-0000-0000"
                                onChange={(e) => setOrcid(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">Leave empty to remove the ORCID iD.</p>
                        </div>
                    )}
                    {!allowOrcid && signedInUrl && (
                        <div className="space-y-2">
                            <Label htmlFor={`${id}-signed-orcid`}>Signed-in ORCID iD</Label>
                            <Input id={`${id}-signed-orcid`} value={signedInUrl} readOnly />
                            {canLinkOrcid && (
                                <div className="flex items-center gap-2">
                                    <Checkbox
                                        id={`${id}-link`}
                                        checked={linkOrcid}
                                        onCheckedChange={(v) => setLinkOrcid(v === true)}
                                    />
                                    <Label htmlFor={`${id}-link`}>Add my verified ORCID iD to my articles</Label>
                                </div>
                            )}
                        </div>
                    )}

                    {preview && (
                        <div className="rounded-md border border-border/60 p-3 text-sm space-y-2" role="status">
                            <p>
                                Will update {preview.account ? 1 : 0} account(s), {preview.bylines} bylines on{" "}
                                {preview.changed_publications} articles; {preview.dois_marked_stale} DOIs will be
                                re-deposited to Crossref
                            </p>
                            {preview.warnings.length > 0 && (
                                <ul className="list-disc pl-5 text-amber-700 dark:text-amber-400">
                                    {preview.warnings.map((w) => (
                                        <li key={w}>{w}</li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    )}
                    {sentTo && (
                        <p className="text-sm" role="status">
                            A confirmation link was sent to {sentTo}; the email changes once it is opened.
                        </p>
                    )}

                    <div className="flex gap-2">
                        {onPreview && (
                            <Button type="button" variant="outline" onClick={onPreviewClick} disabled={pending}>
                                Preview changes
                            </Button>
                        )}
                        <Button type="submit" disabled={pending}>
                            {pending ? "Working…" : "Save"}
                        </Button>
                    </div>
                </form>
            </CardContent>
        </Card>
    )
}
