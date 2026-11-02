"use client"

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"

export interface PersonValues {
    givenName: string | null
    familyName: string | null
    email: string
    orcid: string | null
}

export interface PersonUpdateSummary {
    account: { user_id: number } | null
    bylines: number
    publications: number
    changed_publications: number
    dois_marked_stale: number
    /** Distinct names under this email; more than one may mean several people. */
    names: string[]
    before: PersonValues
    after: PersonValues
    warnings: string[]
}

export type MyProfile = PersonUpdateSummary & { signedInOrcid: string }

export interface PersonSaveResult {
    applied: PersonUpdateSummary | null
    confirmationSentTo: string | null
}

export interface AdminPersonInput {
    matchEmail: string
    givenName?: string
    familyName?: string
    email?: string
    orcid?: string | null
    /** Confirmed that the differently named records under matchEmail are one person. */
    samePerson?: boolean
}

export interface MyProfileInput {
    givenName?: string
    familyName?: string
    email?: string
    linkOrcid?: boolean
}

/** Error carrying the HTTP status; the message is the server's text. */
export class AuthorProfileApiError extends Error {
    status: number
    constructor(status: number, message: string) {
        super(message)
        this.status = status
    }
}

interface Envelope<T> {
    success: boolean
    data?: T
    error?: string
    message?: string
}

async function request<T>(url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        credentials: "same-origin",
        headers: body === undefined ? undefined : { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as Envelope<T>
    if (!res.ok || json.success === false) {
        throw new AuthorProfileApiError(
            res.status,
            json.message || json.error || `Request failed (HTTP ${res.status})`,
        )
    }
    return json.data as T
}

export function useAdminPerson(email: string | null) {
    return useQuery<PersonUpdateSummary>({
        queryKey: ["admin-person", email],
        // POST, so the email stays out of access logs.
        queryFn: () => request<PersonUpdateSummary>("/api/author-profile/person/lookup", { email }),
        enabled: !!email,
        retry: false,
    })
}

export function useAdminPersonPreview() {
    return useMutation({
        mutationFn: (input: AdminPersonInput) =>
            request<PersonUpdateSummary>("/api/author-profile/person/preview", input),
    })
}

export function useAdminPersonSave() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (input: AdminPersonInput) => request<PersonSaveResult>("/api/author-profile/person", input),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-person"] }),
    })
}

export function useMyProfile(enabled = true) {
    return useQuery<MyProfile>({
        queryKey: ["my-profile"],
        queryFn: () => request<MyProfile>("/api/account/profile"),
        enabled,
        retry: false,
    })
}

export function useSaveMyProfile() {
    const qc = useQueryClient()
    return useMutation({
        mutationFn: (input: MyProfileInput) => request<PersonSaveResult>("/api/account/profile", input),
        onSuccess: () => qc.invalidateQueries({ queryKey: ["my-profile"] }),
    })
}

export function useConfirmEmail() {
    return useMutation({
        mutationFn: (token: string) => request<{ email: string }>("/api/account/confirm-email", { token }),
    })
}
