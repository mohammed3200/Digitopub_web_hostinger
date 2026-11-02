"use client"

import { UserRound } from "lucide-react"
import { OrcidSignInCard } from "@/components/auth/orcid-sign-in-card"
import { useIdentity } from "@/src/hooks/use-identity"
import { PersonEditForm } from "@/src/features/author-profile/components/person-edit-form"
import { useMyProfile, useSaveMyProfile } from "@/src/features/author-profile/api/use-author-profile"

export default function AccountProfilePage() {
    const { data: identity, isLoading } = useIdentity()
    const authenticated = !!identity?.authenticated
    const query = useMyProfile(authenticated)
    const save = useSaveMyProfile()

    const wrapper = "container max-w-[760px] py-10 lg:py-16 mx-auto px-4 sm:px-6"

    if (isLoading) {
        return (
            <div className={wrapper}>
                <p className="text-sm text-muted-foreground">Loading…</p>
            </div>
        )
    }

    if (!authenticated) {
        return (
            <div className={wrapper}>
                <OrcidSignInCard returnUrl="/account/profile" />
            </div>
        )
    }

    return (
        <div className={`${wrapper} space-y-6`}>
            <header className="space-y-2">
                <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
                    <UserRound className="h-7 w-7 text-primary" />
                    Author profile
                </h1>
                <p className="text-sm text-muted-foreground">
                    Changes apply to your author&apos;s OJS account and to every article byline that carries
                    your email address.
                </p>
            </header>

            {query.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {query.isError && (
                <p role="alert" className="text-sm text-muted-foreground">
                    {query.error instanceof Error ? query.error.message : "Something went wrong. Please try again."}
                </p>
            )}
            {query.data && (
                <PersonEditForm
                    key={query.data.before.email}
                    current={query.data}
                    allowOrcid={false}
                    signedInOrcid={query.data.signedInOrcid}
                    onSave={(c) => save.mutateAsync(c)}
                />
            )}
        </div>
    )
}
