"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { AuthorProfileApiError, useConfirmEmail } from "@/src/features/author-profile/api/use-author-profile"

type State = "working" | "confirmed" | "invalid" | "expired" | "used" | "error"

const TEXT: Record<Exclude<State, "working" | "confirmed">, string> = {
    invalid: "This confirmation link is not valid. Please request a new email change from your profile.",
    expired: "This confirmation link has expired. Please request the email change again from your profile.",
    used: "This link was already used, or the address is already in use by another account.",
    error: "We could not confirm your email right now. Please try again later.",
}

function Confirm() {
    const token = useSearchParams().get("token")
    const confirm = useConfirmEmail()
    const started = useRef(false)
    const [state, setState] = useState<State>(token ? "working" : "invalid")
    const [email, setEmail] = useState<string | null>(null)

    useEffect(() => {
        if (!token || started.current) return
        started.current = true
        confirm
            .mutateAsync(token)
            .then((r) => {
                setEmail(r.email)
                setState("confirmed")
            })
            .catch((err) => {
                const status = err instanceof AuthorProfileApiError ? err.status : 0
                setState(status === 400 ? "invalid" : status === 410 ? "expired" : status === 409 ? "used" : "error")
            })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [token])

    return (
        <div className="space-y-4">
            <h1 className="text-2xl sm:text-3xl font-bold">Confirm email change</h1>
            {state === "working" && <p className="text-sm text-muted-foreground">Confirming…</p>}
            {state === "confirmed" && (
                <p role="status" className="text-sm">
                    Your email is now {email}. It has been updated on your author profile and articles.
                </p>
            )}
            {state !== "working" && state !== "confirmed" && (
                <p role="alert" className="text-sm text-destructive">
                    {TEXT[state]}
                </p>
            )}
            <Link href="/account/profile" className="text-sm font-semibold text-primary hover:underline">
                Go to my author profile
            </Link>
        </div>
    )
}

export default function ConfirmEmailPage() {
    return (
        <div className="container max-w-[760px] py-10 lg:py-16 mx-auto px-4 sm:px-6">
            <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}>
                <Confirm />
            </Suspense>
        </div>
    )
}
