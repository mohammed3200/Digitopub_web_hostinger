/**
 * Account self-service: GET /stats, DELETE /data, and publication-alert
 * management under /notifications (#199).
 * All require a valid digitopub_identity cookie.
 */

import { Hono } from "hono"
import { zValidator } from "@hono/zod-validator"
import { prisma } from "@/src/lib/db/config"
import { checkRateLimit } from "@/src/lib/rate-limiter"
import { NOTIFY_SUBSCRIBE_EMAIL_RATE_LIMIT, NOTIFY_SUBSCRIBE_IP_RATE_LIMIT } from "@/src/lib/rate-limiter-configs"
import { clientIpFromHeaders } from "@/src/lib/ip-hash"
import { accountSubscribeSchema } from "@/src/features/notifications/schemas/notification-schemas"
import {
    getAccountNotifications,
    linkIdentity,
    requestSubscription,
} from "@/src/features/notifications/server/public-service"
import { SUBSCRIBE_GENERIC_MESSAGE, consentIpHash, sendLater } from "@/src/server/routes/notifications-public"
import {
    buildClearCookieHeader,
    getIdentity,
    invalidateRevocationCache,
} from "@/src/lib/identity-cookie"
import { previewPersonUpdate } from "@/src/lib/ojs-write-guard"
import { confirmEmailSchema, selfPersonEditSchema } from "@/src/features/author-profile/schemas/person-edit"
import { applyPersonEdit, messageForCode, resolveSelfEmail, statusForCode } from "@/src/features/author-profile/server/service"
import { confirmEmailChange } from "@/src/features/author-profile/server/email-change"

const app = new Hono()

function err(code: string, status: number, message?: string) {
    return new Response(JSON.stringify({ success: false, error: code, message }), {
        status,
        headers: { "Content-Type": "application/json" },
    })
}

app.get("/stats", async (c) => {
    const identity = await getIdentity(c.req.raw.headers)
    if (!identity) return err("UNAUTHENTICATED", 401, "Sign in with ORCID.")

    const lifetime = await prisma.userMetrics.findUnique({
        where: { orcid: identity.orcid },
    })

    // Last 12 months of monthly rollup, including empty months.
    const now = new Date()
    const months: Array<{ year: number; month: number }> = []
    for (let i = 11; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
        months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 })
    }

    // Build monthly counts directly from user_event for THIS orcid (the
    // aggregate tables are not per-ORCID).
    const start = new Date(Date.UTC(months[0].year, months[0].month - 1, 1))
    interface Row {
        ym: string
        views: bigint
        downloads: bigint
        citations: bigint
    }
    const rows = await prisma.$queryRawUnsafe<Row[]>(
        `SELECT
            DATE_FORMAT(created_at, '%Y-%m') AS ym,
            SUM(CASE WHEN event_type='view' THEN 1 ELSE 0 END) AS views,
            SUM(CASE WHEN event_type='download' THEN 1 ELSE 0 END) AS downloads,
            SUM(CASE WHEN event_type='citation_export' THEN 1 ELSE 0 END) AS citations
         FROM user_event
         WHERE orcid = ? AND created_at >= ?
         GROUP BY ym`,
        identity.orcid,
        start
    )
    const byKey = new Map(rows.map((r) => [r.ym, r]))

    const monthly = months.map(({ year, month }) => {
        const key = `${year}-${String(month).padStart(2, "0")}`
        const r = byKey.get(key)
        return {
            year,
            month,
            views: Number(r?.views ?? BigInt(0)),
            downloads: Number(r?.downloads ?? BigInt(0)),
            citations: Number(r?.citations ?? BigInt(0)),
        }
    })

    return c.json({
        success: true,
        data: {
            orcid: identity.orcid,
            lifetime: {
                views: lifetime?.views ?? 0,
                downloads: lifetime?.downloads ?? 0,
                citations: lifetime?.citations ?? 0,
                first_seen_at: lifetime?.first_seen_at?.toISOString() ?? null,
                last_event_at: lifetime?.last_event_at?.toISOString() ?? null,
            },
            monthly,
        },
    })
})

app.delete("/data", async (c) => {
    const identity = await getIdentity(c.req.raw.headers)
    if (!identity) return err("UNAUTHENTICATED", 401, "Sign in with ORCID.")

    const now = Math.floor(Date.now() / 1000)

    // Delete in a transaction so partial-state recovery is clean.
    const result = await prisma.$transaction(async (tx) => {
        const userEventRows = await tx.userEvent.deleteMany({
            where: { orcid: identity.orcid },
        })
        const userMetricsRows = await tx.userMetrics.deleteMany({
            where: { orcid: identity.orcid },
        })
        const linkRows = await tx.userOrcidLink.deleteMany({
            where: { orcid: identity.orcid },
        })
        // Alert subscriptions linked to this ORCID iD or its verified email
        // (interests, follows and deliveries cascade by FK).
        const subscriberRows = await tx.notificationSubscriber.deleteMany({
            where: {
                OR: [
                    { orcid: identity.orcid },
                    ...(identity.email_hash ? [{ email_hash: identity.email_hash }] : []),
                ],
            },
        })
        // Pending author email changes this ORCID iD asked for (#233).
        const emailChangeRows = await tx.personEmailChange.deleteMany({
            where: { requested_by_orcid: identity.orcid },
        })
        await tx.revokedOrcid.upsert({
            where: { orcid: identity.orcid },
            create: { orcid: identity.orcid, cookie_iat_min: now },
            update: { cookie_iat_min: now, revoked_at: new Date() },
        })
        return {
            user_event_rows: userEventRows.count,
            user_metrics_rows: userMetricsRows.count,
            user_orcid_links_rows: linkRows.count,
            notification_subscriber_rows: subscriberRows.count,
            person_email_change_rows: emailChangeRows.count,
        }
    })

    invalidateRevocationCache(identity.orcid)

    return new Response(
        JSON.stringify({
            success: true,
            deleted: result,
        }),
        {
            status: 200,
            headers: {
                "Content-Type": "application/json",
                "Set-Cookie": buildClearCookieHeader(),
            },
        }
    )
})

// ─── Publication alerts (#199) ────────────────────────────────────────

app.get("/notifications", async (c) => {
    const identity = await getIdentity(c.req.raw.headers)
    if (!identity) return err("UNAUTHENTICATED", 401, "Sign in with ORCID.")
    return c.json({ success: true, data: await getAccountNotifications(identity) })
})

app.post("/notifications/link", async (c) => {
    const identity = await getIdentity(c.req.raw.headers)
    if (!identity) return err("UNAUTHENTICATED", 401, "Sign in with ORCID.")
    const linked = await linkIdentity(identity)
    if (!linked) return err("NOTHING_TO_LINK", 404, "No alert subscription matches your verified email.")
    return c.json({ success: true, data: await getAccountNotifications(identity) })
})

/** Same double opt-in as the public form; the confirmed row is linked to the ORCID iD. */
app.post("/notifications/subscribe", zValidator("json", accountSubscribeSchema), async (c) => {
    const identity = await getIdentity(c.req.raw.headers)
    if (!identity) return err("UNAUTHENTICATED", 401, "Sign in with ORCID.")
    const body = c.req.valid("json")
    const generic = c.json({ success: true, message: SUBSCRIBE_GENERIC_MESSAGE }, 202)

    const ip = clientIpFromHeaders(c.req.raw.headers)
    const byIp = checkRateLimit(ip, NOTIFY_SUBSCRIBE_IP_RATE_LIMIT)
    if (!byIp.allowed) return err("RATE_LIMITED", 429, "Too many requests. Please try again later.")
    if (!checkRateLimit(body.email.trim().toLowerCase(), NOTIFY_SUBSCRIBE_EMAIL_RATE_LIMIT).allowed) return generic

    try {
        sendLater(await requestSubscription({
            email: body.email,
            name: body.name,
            journal_ids: body.journal_ids,
            discipline_ids: body.discipline_ids,
            source: "orcid_account",
            orcid: identity.orcid,
            ipHash: consentIpHash(ip),
        }))
    } catch (e) {
        console.error("[Notifications] account subscribe failed:", e instanceof Error ? e.message : e)
    }
    return generic
})

// ─── Author profile self-service (#233) ───────────────────────────────

const PROFILE_EDIT_RATE_LIMIT = { maxRequests: 5, windowMs: 60 * 60 * 1000, keyPrefix: "profile:edit:orcid" }
const CONFIRM_EMAIL_RATE_LIMIT = { maxRequests: 20, windowMs: 60 * 60 * 1000, keyPrefix: "profile:confirm:ip" }

/** The signed-in author's record in OJS (names, email, ORCID iD, counts). */
app.get("/profile", async (c) => {
    const identity = await getIdentity(c.req.raw.headers)
    if (!identity) return err("UNAUTHENTICATED", 401, "Sign in with ORCID.")
    const me = await resolveSelfEmail(identity)
    if (!me.ok) return err("NO_RECORD", me.status, me.error)
    const result = await previewPersonUpdate(me.email)
    if (!result.success) return err(result.code.toUpperCase(), statusForCode(result.code), messageForCode(result.code))
    const { success: _s, auditId: _a, ...data } = result
    return c.json({ success: true, data: { ...data, signedInOrcid: identity.orcid } })
})

/** Edit one's own names/email; the ORCID iD can only be set to the signed-in one. */
app.post("/profile", zValidator("json", selfPersonEditSchema), async (c) => {
    const identity = await getIdentity(c.req.raw.headers)
    if (!identity) return err("UNAUTHENTICATED", 401, "Sign in with ORCID.")
    if (!checkRateLimit(identity.orcid, PROFILE_EDIT_RATE_LIMIT).allowed) {
        return err("RATE_LIMITED", 429, "Too many changes. Please try again later.")
    }
    const me = await resolveSelfEmail(identity)
    if (!me.ok) return err("NO_RECORD", me.status, me.error)

    const { linkOrcid, ...changes } = c.req.valid("json")
    const outcome = await applyPersonEdit({
        matchEmail: me.email,
        changes: { ...changes, ...(linkOrcid ? { orcid: identity.orcid } : {}) },
        actor: { orcid: identity.orcid },
    })
    if (!outcome.ok) return err(outcome.code.toUpperCase(), outcome.status, outcome.error)
    return c.json({ success: true, data: { applied: outcome.applied, confirmationSentTo: outcome.confirmationSentTo } })
})

/** Confirmation link for a new email; works without signing in (the token is the proof). */
app.post("/confirm-email", zValidator("json", confirmEmailSchema), async (c) => {
    if (!checkRateLimit(clientIpFromHeaders(c.req.raw.headers), CONFIRM_EMAIL_RATE_LIMIT).allowed) {
        return err("RATE_LIMITED", 429, "Too many requests. Please try again later.")
    }
    const result = await confirmEmailChange(c.req.valid("json").token)
    switch (result.status) {
        case "confirmed":
            return c.json({ success: true, data: { email: result.newEmail } })
        case "invalid":
            return err("INVALID_LINK", 400, "This confirmation link is not valid.")
        case "expired":
            return err("EXPIRED_LINK", 410, "This confirmation link has expired. Ask for the change again.")
        case "used":
            return err("USED_LINK", 409, "This confirmation link was already used.")
        case "failed":
            return err(result.code.toUpperCase(), statusForCode(result.code), messageForCode(result.code))
    }
})

export { app as accountRouter }
