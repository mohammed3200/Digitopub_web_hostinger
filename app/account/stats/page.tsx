"use client"

import Link from "next/link"
import { BarChart3, Download, Eye, Quote } from "lucide-react"
import { OrcidSignInCard } from "@/components/auth/orcid-sign-in-card"
import { useAccountStats } from "@/src/features/account/api/use-account"
import {
    Bar,
    BarChart,
    CartesianGrid,
    Legend,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts"

const MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]

export default function AccountStatsPage() {
    const query = useAccountStats()

    if (query.isLoading) {
        return (
            <div className="container max-w-[1100px] py-10 lg:py-16 mx-auto px-4 sm:px-6">
                <p className="text-sm text-muted-foreground">Loading your engagement…</p>
            </div>
        )
    }
    // Anonymous visitors get an explicit sign-in card instead of the old
    // auto-redirect to /api/auth/orcid/start (a dead-end when ORCID is
    // unconfigured in production).
    const isUnauthenticated =
        query.data &&
        !("data" in query.data) &&
        query.data.success === false &&
        query.data.error === "UNAUTHENTICATED"
    if (isUnauthenticated) {
        return (
            <div className="container max-w-[760px] py-10 lg:py-16 mx-auto px-4 sm:px-6">
                <OrcidSignInCard returnUrl="/account/stats" />
            </div>
        )
    }
    if (!query.data || !("data" in query.data)) {
        return null
    }
    const { orcid, lifetime, monthly } = query.data.data

    const chartData = monthly.map((m) => ({
        label: `${MONTHS[m.month - 1]} ${String(m.year).slice(2)}`,
        views: m.views,
        downloads: m.downloads,
        citations: m.citations,
    }))

    return (
        <div className="container max-w-[1100px] py-10 lg:py-16 mx-auto px-4 sm:px-6 space-y-8">
            <header className="space-y-2">
                <h1 className="text-2xl sm:text-3xl font-bold flex items-center gap-3">
                    <BarChart3 className="h-7 w-7 text-primary" />
                    Your engagement
                </h1>
                <p className="text-sm text-muted-foreground">
                    Lifetime activity attributed to ORCID iD{" "}
                    <span className="font-mono text-foreground">{orcid}</span>.
                </p>
            </header>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card label="Views" value={lifetime.views} icon={<Eye className="h-4 w-4" />} />
                <Card
                    label="Downloads"
                    value={lifetime.downloads}
                    icon={<Download className="h-4 w-4" />}
                />
                <Card
                    label="Citations exported"
                    value={lifetime.citations}
                    icon={<Quote className="h-4 w-4" />}
                />
            </div>

            <section className="rounded-xl border border-border/60 bg-card p-4 sm:p-6 shadow-sm">
                <h2 className="text-base font-semibold mb-4">Last 12 months</h2>
                <div className="h-[280px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.1} />
                            <XAxis dataKey="label" fontSize={11} />
                            <YAxis fontSize={11} allowDecimals={false} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="views" fill="var(--chart-1)" />
                            <Bar dataKey="downloads" fill="var(--chart-2)" />
                            <Bar dataKey="citations" fill="var(--chart-3)" />
                        </BarChart>
                    </ResponsiveContainer>
                </div>
            </section>

            <p className="text-xs text-muted-foreground">
                Want to remove this history?{" "}
                <Link
                    href="/account/data"
                    className="font-semibold text-primary hover:underline"
                >
                    Delete my engagement data
                </Link>
                .
            </p>
            <p className="text-xs text-muted-foreground">
                Your name or email wrong on your articles?{" "}
                <Link
                    href="/account/profile"
                    className="font-semibold text-primary hover:underline"
                >
                    Edit my author profile
                </Link>
                .
            </p>
        </div>
    )
}

function Card({
    label,
    value,
    icon,
}: {
    label: string
    value: number
    icon: React.ReactNode
}) {
    return (
        <div className="rounded-xl border border-border/60 bg-card p-5 shadow-sm">
            <div className="flex items-center gap-2 text-xs uppercase font-semibold tracking-wider text-muted-foreground">
                {icon}
                {label}
            </div>
            <div className="mt-2 text-3xl font-bold tabular-nums">
                {value.toLocaleString()}
            </div>
        </div>
    )
}
