import { describe, it, expect, vi, beforeEach } from "vitest"
import { Hono } from "hono"

let mockSession: { id: string; role: string } | null = null

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }))
vi.mock("server-only", () => ({}))
vi.mock("@/src/lib/db/auth", () => ({
  getSession: vi.fn(() => mockSession),
  createSession: vi.fn(),
  destroySession: vi.fn(),
}))
vi.mock("@/src/lib/db/config", () => ({
  prisma: { revokedOrcid: { findUnique: vi.fn(async () => null) } },
}))
vi.mock("@/src/lib/email/service", () => ({ sendEmail: vi.fn(), sendTemplateEmail: vi.fn() }))

const h = vi.hoisted(() => ({
  previewPersonUpdate: vi.fn(),
  updatePersonInOjsWithAudit: vi.fn(),
  requestEmailChange: vi.fn(),
  confirmEmailChange: vi.fn(),
  ojsQuery: vi.fn(),
}))

vi.mock("@/src/lib/ojs-write-guard", () => ({
  previewPersonUpdate: h.previewPersonUpdate,
  updatePersonInOjsWithAudit: h.updatePersonInOjsWithAudit,
}))
vi.mock("@/src/features/author-profile/server/email-change", () => ({
  requestEmailChange: h.requestEmailChange,
  confirmEmailChange: h.confirmEmailChange,
}))
vi.mock("@/src/features/ojs/server/ojs-client", () => ({ ojsQuery: h.ojsQuery }))

process.env.IDENTITY_COOKIE_SECRET ||= "test-secret"
process.env.ORCID_STATE_SECRET ||= "test-secret"
process.env.EVENT_IP_HASH_SALT_SEED ||= "test-secret"
process.env.ORCID_CLIENT_ID ||= "test-orcid-client"
process.env.ORCID_CLIENT_SECRET ||= "test-secret"

import { authorProfileRouter } from "@/src/features/author-profile/server/route"
import { accountRouter } from "@/src/server/routes/account"
import { IDENTITY_COOKIE_NAME, mintCookie, __resetRevocationCacheForTests } from "@/src/lib/identity-cookie"
import { __resetRateLimiterForTests } from "@/src/lib/rate-limiter"
import { emailHash } from "@/src/lib/email-hash"

const ORCID = "0000-0002-1825-0097"
const SUMMARY = {
  account: null,
  bylines: 2,
  publications: 2,
  changed_publications: 2,
  dois_marked_stale: 1,
  names: ["Alice Old"],
  before: { givenName: "Alice", familyName: "Old", email: "alice@example.org", orcid: null },
  after: { givenName: "Alice", familyName: "New", email: "alice@example.org", orcid: null },
  warnings: [],
}

const app = new Hono().route("/author-profile", authorProfileRouter).route("/account", accountRouter)

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`http://test${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  })
}

/** Signed in with ORCID; `verifiedEmail` is the email ORCID shared at sign-in (hashed in the cookie). */
function signedIn(ojsUserId: number | null = null, verifiedEmail: string | null = "alice@example.org") {
  const cookie = mintCookie({ orcid: ORCID, ojs_user_id: ojsUserId, email_hash: emailHash(verifiedEmail) })
  return { cookie: `${IDENTITY_COOKIE_NAME}=${encodeURIComponent(cookie)}` }
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset()
  mockSession = { id: "3", role: "admin" }
  __resetRevocationCacheForTests()
  __resetRateLimiterForTests()
  h.requestEmailChange.mockResolvedValue({ sent: true, expiresAt: new Date() })
})

describe("admin /api/author-profile (#233)", () => {
  it("requires an admin", async () => {
    mockSession = null
    const res = await post("/author-profile/person/lookup", { email: "alice@example.org" })
    expect(res.status).toBe(401)
    expect(h.previewPersonUpdate).not.toHaveBeenCalled()
  })

  it("returns the current values", async () => {
    h.previewPersonUpdate.mockResolvedValue({ success: true, auditId: null, ...SUMMARY })
    const res = await post("/author-profile/person/lookup", { email: "alice@example.org" })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ bylines: 2, before: { familyName: "Old" } })
    expect(h.previewPersonUpdate).toHaveBeenCalledWith("alice@example.org")
  })

  it("maps a not_found preview to 404", async () => {
    h.previewPersonUpdate.mockResolvedValue({ success: false, auditId: null, code: "not_found", error: "x" })
    const res = await post("/author-profile/person/lookup", { email: "nobody@example.org" })
    expect(res.status).toBe(404)
  })

  it("applies names at once with the admin as actor", async () => {
    h.updatePersonInOjsWithAudit.mockResolvedValue({ success: true, auditId: 9n, ...SUMMARY })
    const res = await post("/author-profile/person", { matchEmail: "alice@example.org", familyName: "New" })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ applied: { dois_marked_stale: 1 }, confirmationSentTo: null })
    expect(h.updatePersonInOjsWithAudit).toHaveBeenCalledWith({
      matchEmail: "alice@example.org",
      changes: { familyName: "New" },
      actorAdminId: 3n,
      actorOrcid: null,
    })
    expect(h.requestEmailChange).not.toHaveBeenCalled()
  })

  it("never writes a new email directly: checks it, then sends a confirmation link", async () => {
    h.previewPersonUpdate.mockResolvedValue({ success: true, auditId: null, ...SUMMARY })
    const res = await post("/author-profile/person", { matchEmail: "alice@example.org", email: "alice.new@example.org" })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ applied: null, confirmationSentTo: "alice.new@example.org" })
    expect(h.previewPersonUpdate).toHaveBeenCalledWith("alice@example.org", { email: "alice.new@example.org" }, { samePerson: undefined })
    expect(h.updatePersonInOjsWithAudit).not.toHaveBeenCalled()
    expect(h.requestEmailChange).toHaveBeenCalledWith({
      oldEmail: "alice@example.org",
      newEmail: "alice.new@example.org",
      actor: { adminId: 3n },
      samePerson: undefined,
    })
  })

  it("passes the bridge's names through when one email covers several people", async () => {
    h.updatePersonInOjsWithAudit.mockResolvedValue({
      success: false, auditId: 9n, code: "ambiguous_person", error: "x", names: ["Alice Old", "Carol Co"],
    })
    const res = await post("/author-profile/person", { matchEmail: "alice@example.org", familyName: "New" })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: "ambiguous_person", names: ["Alice Old", "Carol Co"] })
  })

  it("sends samePerson once the admin confirms", async () => {
    h.updatePersonInOjsWithAudit.mockResolvedValue({ success: true, auditId: 9n, ...SUMMARY })
    await post("/author-profile/person", { matchEmail: "alice@example.org", familyName: "New", samePerson: true })
    expect(h.updatePersonInOjsWithAudit.mock.calls[0][0]).toMatchObject({ samePerson: true })
  })

  it("refuses an email that belongs to someone else before saving anything", async () => {
    h.previewPersonUpdate.mockResolvedValue({ success: false, auditId: null, code: "email_in_use", error: "x" })
    const res = await post("/author-profile/person", { matchEmail: "alice@example.org", email: "bob@example.org", familyName: "New" })
    expect(res.status).toBe(409)
    expect((await res.json()).code).toBe("email_in_use")
    expect(h.updatePersonInOjsWithAudit).not.toHaveBeenCalled()
    expect(h.requestEmailChange).not.toHaveBeenCalled()
  })

  it("applies a case-only email change directly", async () => {
    h.updatePersonInOjsWithAudit.mockResolvedValue({ success: true, auditId: 9n, ...SUMMARY })
    await post("/author-profile/person", { matchEmail: "alice@example.org", email: "Alice@Example.org" })
    expect(h.updatePersonInOjsWithAudit.mock.calls[0][0].changes).toEqual({ email: "Alice@Example.org" })
    expect(h.requestEmailChange).not.toHaveBeenCalled()
  })

  it("maps an unreachable OJS to 503", async () => {
    h.updatePersonInOjsWithAudit.mockResolvedValue({ success: false, auditId: 9n, code: "unavailable", error: "x" })
    const res = await post("/author-profile/person", { matchEmail: "alice@example.org", familyName: "New" })
    expect(res.status).toBe(503)
  })

  it("validates input", async () => {
    const res = await post("/author-profile/person", { matchEmail: "not-an-email", givenName: "" })
    expect(res.status).toBe(400)
  })
})

describe("self-service /api/account/profile (#233)", () => {
  it("requires an ORCID sign-in", async () => {
    expect((await app.request("http://test/account/profile")).status).toBe(401)
    expect((await post("/account/profile", { familyName: "X" })).status).toBe(401)
  })

  it("finds the author by the bylines carrying their ORCID iD", async () => {
    h.ojsQuery.mockResolvedValue([{ email: "alice@example.org" }])
    h.previewPersonUpdate.mockResolvedValue({ success: true, auditId: null, ...SUMMARY })
    const res = await app.request("http://test/account/profile", { headers: signedIn() })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toMatchObject({ signedInOrcid: ORCID, bylines: 2 })
    // Compared as the bare iD, whatever URL form the byline stored.
    expect(h.ojsQuery.mock.calls[0][1]).toEqual([ORCID])
  })

  it("uses the linked OJS account's email first", async () => {
    h.ojsQuery.mockResolvedValueOnce([{ email: "alice@example.org" }]).mockResolvedValue([])
    h.previewPersonUpdate.mockResolvedValue({ success: true, auditId: null, ...SUMMARY })
    await app.request("http://test/account/profile", { headers: signedIn(12) })
    expect(h.ojsQuery.mock.calls[0]).toEqual(["SELECT email FROM users WHERE user_id = ?", [12]])
    expect(h.previewPersonUpdate).toHaveBeenCalledWith("alice@example.org")
  })

  it("picks, among bylines carrying the ORCID iD, the email ORCID verified", async () => {
    h.ojsQuery.mockResolvedValue([{ email: "other@example.org" }, { email: "alice@example.org" }])
    h.previewPersonUpdate.mockResolvedValue({ success: true, auditId: null, ...SUMMARY })
    expect((await app.request("http://test/account/profile", { headers: signedIn() })).status).toBe(200)
    expect(h.previewPersonUpdate).toHaveBeenCalledWith("alice@example.org")
  })

  it("never trusts a byline ORCID iD alone: a submitter-typed iD on someone else's byline gives no access", async () => {
    // The attacker's ORCID iD was typed onto a byline with the victim's email.
    h.ojsQuery.mockResolvedValue([{ email: "victim@example.org" }])
    const headers = signedIn(null, "attacker@example.org")
    expect((await app.request("http://test/account/profile", { headers })).status).toBe(404)
    expect((await post("/account/profile", { email: "attacker@example.org" }, headers)).status).toBe(404)
    expect(h.previewPersonUpdate).not.toHaveBeenCalled()
    expect(h.updatePersonInOjsWithAudit).not.toHaveBeenCalled()
    expect(h.requestEmailChange).not.toHaveBeenCalled()
  })

  it("refuses when ORCID shared no verified email", async () => {
    h.ojsQuery.mockResolvedValue([{ email: "alice@example.org" }])
    const res = await app.request("http://test/account/profile", { headers: signedIn(null, null) })
    expect(res.status).toBe(404)
    expect(h.ojsQuery).not.toHaveBeenCalled()
  })

  it("can only set the signed-in ORCID iD, and records the author as actor", async () => {
    h.ojsQuery.mockResolvedValue([{ email: "alice@example.org" }])
    h.updatePersonInOjsWithAudit.mockResolvedValue({ success: true, auditId: 9n, ...SUMMARY })
    const res = await post("/account/profile", { familyName: "New", linkOrcid: true, orcid: "0000-0001-5109-3700" }, signedIn())
    expect(res.status).toBe(200)
    expect(h.updatePersonInOjsWithAudit).toHaveBeenCalledWith({
      matchEmail: "alice@example.org",
      changes: { familyName: "New", orcid: ORCID },
      actorAdminId: null,
      actorOrcid: ORCID,
    })
  })

  it("limits changes to 5 an hour per ORCID iD", async () => {
    h.ojsQuery.mockResolvedValue([{ email: "alice@example.org" }])
    h.updatePersonInOjsWithAudit.mockResolvedValue({ success: true, auditId: 9n, ...SUMMARY })
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await post("/account/profile", { familyName: `N${i}` }, signedIn())).status)
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429])
  })
})

describe("POST /api/account/confirm-email (#233)", () => {
  it.each([
    [{ status: "confirmed", newEmail: "alice.new@example.org" }, 200],
    [{ status: "invalid" }, 400],
    [{ status: "expired" }, 410],
    [{ status: "used" }, 409],
    [{ status: "failed", code: "email_in_use" }, 409],
    [{ status: "failed", code: "unavailable" }, 503],
  ])("answers %o with %i", async (result, status) => {
    h.confirmEmailChange.mockResolvedValue(result)
    const res = await post("/account/confirm-email", { token: "a".repeat(43) })
    expect(res.status).toBe(status)
  })

  it("works without signing in", async () => {
    h.confirmEmailChange.mockResolvedValue({ status: "confirmed", newEmail: "x@example.org" })
    expect((await post("/account/confirm-email", { token: "a".repeat(43) })).status).toBe(200)
  })
})
