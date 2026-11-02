import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"

const hoisted = vi.hoisted(() => ({
    auditCreate: vi.fn(),
    auditUpdate: vi.fn(),
}))

vi.mock("@/src/lib/db/config", () => ({
    prisma: { auditOjsWrite: { create: hoisted.auditCreate, update: hoisted.auditUpdate } },
}))

import { personTargetId, previewPersonUpdate, updatePersonInOjsWithAudit } from "@/src/lib/ojs-write-guard"

const fetchMock = vi.fn()

function answer(status: number, body: unknown) {
    return new Response(JSON.stringify(body), { status })
}

const OK = {
    success: true,
    dry_run: false,
    account: { user_id: 12 },
    bylines: 3,
    publications: 2,
    changed_publications: 2,
    dois_marked_stale: 1,
    before: { givenName: "Alice", familyName: "Old", email: "alice@example.org", orcid: null },
    after: { givenName: "Alice", familyName: "New", email: "alice@example.org", orcid: null },
    warnings: [],
}

describe("updatePersonInOjsWithAudit (#233)", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock)
        fetchMock.mockReset()
        hoisted.auditCreate.mockReset().mockResolvedValue({ id: 9n })
        hoisted.auditUpdate.mockReset().mockResolvedValue({})
        process.env.OJS_BASE_URL = "https://ojs.example.org"
        process.env.OJS_API_KEY = "test-key"
        delete process.env.OJS_USER_BRIDGE_URL
    })
    afterEach(() => vi.unstubAllGlobals())

    it("writes the audit row before calling OJS, then records before/after", async () => {
        const order: string[] = []
        hoisted.auditCreate.mockImplementation(async () => {
            order.push("audit")
            return { id: 9n }
        })
        fetchMock.mockImplementation(async () => {
            order.push("ojs")
            return answer(200, OK)
        })

        const result = await updatePersonInOjsWithAudit({
            matchEmail: "Alice@Example.org",
            changes: { familyName: "New" },
            actorAdminId: 3n,
        })

        expect(order).toEqual(["audit", "ojs"])
        expect(result).toMatchObject({ success: true, auditId: 9n, bylines: 3, dois_marked_stale: 1, after: { familyName: "New" } })
        expect(hoisted.auditCreate.mock.calls[0][0].data).toMatchObject({
            reason: "person_update",
            target_type: "person",
            target_id: personTargetId("alice@example.org"),
            actor_admin_id: 3n,
            ojs_column_set: "fields=familyName",
            after_value: JSON.stringify({ familyName: "New" }),
        })
        const update = hoisted.auditUpdate.mock.calls[0][0]
        expect(update.where).toEqual({ id: 9n })
        expect(update.data).toMatchObject({ success: true, ojs_user_id: 12n, before_value: JSON.stringify(OK.before) })
        const body = JSON.parse(fetchMock.mock.calls[0][1].body)
        expect(body).toEqual({ action: "update_person", match_email: "Alice@Example.org", familyName: "New" })
        expect(body.dry_run).toBeUndefined()
    })

    it("hashes the email for the audit target, ignoring case and spaces", () => {
        expect(personTargetId(" ALICE@example.org ")).toBe(personTargetId("alice@example.org"))
        expect(personTargetId("alice@example.org")).toMatch(/^[0-9a-f]{64}$/)
        expect(personTargetId("alice@example.org")).not.toContain("alice")
    })

    it("records the self-service actor's ORCID iD", async () => {
        fetchMock.mockResolvedValue(answer(200, OK))
        await updatePersonInOjsWithAudit({ matchEmail: "a@example.org", changes: { givenName: "A" }, actorOrcid: "0000-0002-1825-0097" })
        expect(hoisted.auditCreate.mock.calls[0][0].data).toMatchObject({ orcid: "0000-0002-1825-0097", actor_admin_id: null })
    })

    it.each([
        [409, "email_in_use"],
        [409, "orcid_in_use"],
        [404, "not_found"],
        [400, "invalid_orcid"],
    ])("maps a %i %s answer to its code and records the failure", async (status, code) => {
        fetchMock.mockResolvedValue(answer(status, { success: false, error: "refused", code }))
        const result = await updatePersonInOjsWithAudit({ matchEmail: "a@example.org", changes: { email: "b@example.org" } })
        expect(result).toMatchObject({ success: false, auditId: 9n, code })
        expect(hoisted.auditUpdate.mock.calls[0][0].data).toMatchObject({ success: false, error: expect.stringContaining(code) })
    })

    it("sends same_person only when confirmed, and passes the names of an ambiguous email through", async () => {
        fetchMock.mockResolvedValue(answer(409, { success: false, error: "x", code: "ambiguous_person", names: ["Alice Old", "Carol Co"] }))
        const refused = await updatePersonInOjsWithAudit({ matchEmail: "a@example.org", changes: { familyName: "X" } })
        expect(refused).toMatchObject({ success: false, code: "ambiguous_person", names: ["Alice Old", "Carol Co"] })
        expect(JSON.parse(fetchMock.mock.calls[0][1].body).same_person).toBeUndefined()

        fetchMock.mockResolvedValue(answer(200, { ...OK, names: ["Alice Old", "Carol Co"] }))
        const ok = await updatePersonInOjsWithAudit({ matchEmail: "a@example.org", changes: { familyName: "X" }, samePerson: true })
        expect(ok).toMatchObject({ success: true, names: ["Alice Old", "Carol Co"] })
        expect(JSON.parse(fetchMock.mock.calls[1][1].body).same_person).toBe(true)
        expect(hoisted.auditCreate.mock.calls[1][0].data.ojs_column_set).toBe("fields=familyName; same_person")
    })

    it("reports an unreachable bridge as unavailable", async () => {
        fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"))
        const result = await updatePersonInOjsWithAudit({ matchEmail: "a@example.org", changes: { familyName: "X" } })
        expect(result).toMatchObject({ success: false, code: "unavailable" })
    })

    it("reports a bridge without the action (old deploy) as unavailable, not as bad input", async () => {
        fetchMock.mockResolvedValue(answer(400, { success: false, error: "Unknown action" }))
        const result = await updatePersonInOjsWithAudit({ matchEmail: "a@example.org", changes: { familyName: "X" } })
        expect(result).toMatchObject({ success: false, code: "unavailable" })
    })

    it("does not report success when the audit row cannot be resolved", async () => {
        fetchMock.mockResolvedValue(answer(200, OK))
        hoisted.auditUpdate.mockRejectedValue(new Error("db down"))
        await expect(updatePersonInOjsWithAudit({ matchEmail: "a@example.org", changes: { familyName: "X" } })).rejects.toThrow("db down")
    })
})

describe("previewPersonUpdate (#233)", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock)
        fetchMock.mockReset()
        hoisted.auditCreate.mockReset()
        process.env.OJS_BASE_URL = "https://ojs.example.org"
        process.env.OJS_API_KEY = "test-key"
    })
    afterEach(() => vi.unstubAllGlobals())

    it("asks for a dry run and writes no audit row", async () => {
        fetchMock.mockResolvedValue(answer(200, { ...OK, dry_run: true }))
        const result = await previewPersonUpdate("a@example.org", { familyName: "New" })
        expect(result).toMatchObject({ success: true, auditId: null, changed_publications: 2 })
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ match_email: "a@example.org", familyName: "New", dry_run: true })
        expect(hoisted.auditCreate).not.toHaveBeenCalled()
    })

    it("passes the not_found code through", async () => {
        fetchMock.mockResolvedValue(answer(404, { success: false, error: "No OJS account or byline has this email", code: "not_found" }))
        expect(await previewPersonUpdate("nobody@example.org")).toMatchObject({ success: false, code: "not_found" })
    })
})
