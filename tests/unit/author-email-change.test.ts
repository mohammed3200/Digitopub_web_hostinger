import { describe, it, expect, beforeEach, vi } from "vitest"

const h = vi.hoisted(() => ({
    deleteMany: vi.fn(),
    create: vi.fn(),
    del: vi.fn(),
    findUnique: vi.fn(),
    updateMany: vi.fn(),
    update: vi.fn(),
    sendEmail: vi.fn(),
    updatePerson: vi.fn(),
}))

vi.mock("@/src/lib/db/config", () => ({
    prisma: {
        personEmailChange: {
            deleteMany: h.deleteMany,
            create: h.create,
            delete: h.del,
            findUnique: h.findUnique,
            updateMany: h.updateMany,
            update: h.update,
        },
    },
}))
vi.mock("@/src/lib/email/service", () => ({ sendEmail: h.sendEmail }))
vi.mock("@/src/lib/ojs-write-guard", () => ({ updatePersonInOjsWithAudit: h.updatePerson }))

import {
    EMAIL_CHANGE_TTL_MS,
    confirmEmailChange,
    hashEmailChangeToken,
    requestEmailChange,
} from "@/src/features/author-profile/server/email-change"

const NOW = new Date("2026-10-30T12:00:00Z")
const TOKEN = "a".repeat(43)

function pending(overrides: Record<string, unknown> = {}) {
    return {
        id: 5n,
        token_hash: hashEmailChangeToken(TOKEN),
        old_email: "alice@example.org",
        new_email: "alice.new@example.org",
        requested_by_admin_id: 3n,
        requested_by_orcid: null,
        expires_at: new Date(NOW.getTime() + EMAIL_CHANGE_TTL_MS),
        confirmed_at: null,
        ...overrides,
    }
}

beforeEach(() => {
    for (const fn of Object.values(h)) fn.mockReset()
    h.create.mockResolvedValue({ id: 5n })
    h.sendEmail.mockResolvedValue({ success: true })
    h.updateMany.mockResolvedValue({ count: 1 })
    process.env.NEXT_PUBLIC_APP_URL = "https://digitopub.example/"
})

describe("requestEmailChange (#233)", () => {
    it("stores only the token hash and emails the link to the new address", async () => {
        const res = await requestEmailChange({ oldEmail: " Alice@Example.org ", newEmail: "alice.new@example.org", actor: { adminId: 3n }, now: NOW })

        expect(res).toEqual({ sent: true, expiresAt: new Date(NOW.getTime() + EMAIL_CHANGE_TTL_MS) })
        const data = h.create.mock.calls[0][0].data
        expect(data).toMatchObject({ old_email: "alice@example.org", new_email: "alice.new@example.org", requested_by_admin_id: 3n })
        expect(data.token_hash).toMatch(/^[0-9a-f]{64}$/)

        const mail = h.sendEmail.mock.calls[0][0]
        expect(mail.to).toBe("alice.new@example.org")
        const token = /confirm-email\?token=([A-Za-z0-9_-]+)/.exec(mail.text)![1]
        expect(hashEmailChangeToken(token)).toBe(data.token_hash)
        expect(mail.text).toContain("https://digitopub.example/account/confirm-email?token=")
    })

    it("replaces an earlier unconfirmed request and purges old rows", async () => {
        await requestEmailChange({ oldEmail: "alice@example.org", newEmail: "b@example.org", actor: {}, now: NOW })
        expect(h.deleteMany.mock.calls[0][0].where.OR[0]).toEqual({ old_email: "alice@example.org", confirmed_at: null })
        expect(h.deleteMany.mock.calls[0][0].where.OR[1].created_at.lt).toEqual(new Date(NOW.getTime() - 30 * 24 * 3600 * 1000))
    })

    it("removes the row again when the email cannot be sent", async () => {
        h.sendEmail.mockResolvedValue({ success: false, error: "smtp down" })
        h.del.mockResolvedValue({})
        const res = await requestEmailChange({ oldEmail: "a@example.org", newEmail: "b@example.org", actor: {}, now: NOW })
        expect(res.sent).toBe(false)
        expect(h.del).toHaveBeenCalledWith({ where: { id: 5n } })
    })
})

describe("confirmEmailChange (#233)", () => {
    it("rejects malformed and unknown tokens without touching OJS", async () => {
        expect(await confirmEmailChange("bad token!", NOW)).toEqual({ status: "invalid" })
        h.findUnique.mockResolvedValue(null)
        expect(await confirmEmailChange(TOKEN, NOW)).toEqual({ status: "invalid" })
        expect(h.updatePerson).not.toHaveBeenCalled()
    })

    it("rejects an expired or used link", async () => {
        h.findUnique.mockResolvedValue(pending({ expires_at: NOW }))
        expect(await confirmEmailChange(TOKEN, NOW)).toEqual({ status: "expired" })
        h.findUnique.mockResolvedValue(pending({ confirmed_at: NOW }))
        expect(await confirmEmailChange(TOKEN, NOW)).toEqual({ status: "used" })
        expect(h.updatePerson).not.toHaveBeenCalled()
    })

    it("lets only one concurrent request claim the link", async () => {
        h.findUnique.mockResolvedValue(pending())
        h.updateMany.mockResolvedValue({ count: 0 })
        expect(await confirmEmailChange(TOKEN, NOW)).toEqual({ status: "used" })
        expect(h.updatePerson).not.toHaveBeenCalled()
    })

    it("writes the new email through the audited writer and notifies the old address", async () => {
        h.findUnique.mockResolvedValue(pending())
        h.updatePerson.mockResolvedValue({ success: true })
        expect(await confirmEmailChange(TOKEN, NOW)).toEqual({ status: "confirmed", newEmail: "alice.new@example.org" })
        expect(h.updateMany).toHaveBeenCalledWith({ where: { id: 5n, confirmed_at: null }, data: { confirmed_at: NOW } })
        expect(h.updatePerson).toHaveBeenCalledWith({
            matchEmail: "alice@example.org",
            changes: { email: "alice.new@example.org" },
            actorAdminId: 3n,
            actorOrcid: null,
        })
        expect(h.sendEmail.mock.calls[0][0].to).toBe("alice@example.org")
    })

    it("keeps the link usable when OJS is unreachable", async () => {
        h.findUnique.mockResolvedValue(pending())
        h.updatePerson.mockResolvedValue({ success: false, code: "unavailable", error: "timeout" })
        expect(await confirmEmailChange(TOKEN, NOW)).toEqual({ status: "failed", code: "unavailable" })
        expect(h.update.mock.calls[0][0].data).toMatchObject({ confirmed_at: null })
    })

    it("uses up the link when OJS refuses the address", async () => {
        h.findUnique.mockResolvedValue(pending())
        h.updatePerson.mockResolvedValue({ success: false, code: "email_in_use", error: "taken" })
        expect(await confirmEmailChange(TOKEN, NOW)).toEqual({ status: "failed", code: "email_in_use" })
        expect(h.update.mock.calls[0][0].data).not.toHaveProperty("confirmed_at")
        expect(h.sendEmail).not.toHaveBeenCalled()
    })
})
