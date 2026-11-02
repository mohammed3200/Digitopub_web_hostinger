/**
 * Runs the real ojs-user-bridge.php (`update_person`, #233) under `php -S`
 * against a local OJS schema database. Opt-in: set OJS_BRIDGE_TEST_DATABASE_URL
 * (e.g. mysql://app_user:…@127.0.0.1:3307/ojs_test, loaded from
 * submit-manager-database-schema-ojs/*.sql) and have `php` on PATH; otherwise
 * the suite is skipped. Seeds its own rows under @bridge-test.invalid and
 * deletes them afterwards. Never point it at production.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import mysql from "mysql2/promise"

const DB_URL = process.env.OJS_BRIDGE_TEST_DATABASE_URL
// pdo_mysql is often installed but not enabled in php.ini; load it per run then.
const hasPdoMysql = (args: string[]) => spawnSync("php", [...args, "-m"]).stdout?.toString().includes("pdo_mysql") ?? false
const PHP_ARGS = hasPdoMysql([]) ? [] : ["-d", "extension=pdo_mysql"]
const HAS_PHP = hasPdoMysql(PHP_ARGS)
const API_KEY = "bridge-test-key-0123456789abcdef"

// Valid ORCID iDs (check digits verified): ORCID's documented example and a second one.
const ORCID_A = "https://orcid.org/0000-0002-1825-0097"
const ORCID_B = "https://orcid.org/0000-0001-5109-3700"

describe.skipIf(!DB_URL || !HAS_PHP)("ojs-user-bridge.php update_person", () => {
  let db: mysql.Connection
  let server: ChildProcess
  let dir: string
  let url: string
  let journalId: number
  const ids = { users: [] as number[], submissions: [] as number[], publications: [] as number[], dois: [] as number[], authors: [] as number[] }
  let seed: { userId: number; pub1: number; pub2: number; doi1: number; doi2: number; authorA1: number; authorA2: number; authorB: number }

  const freePort = () =>
    new Promise<number>((resolve) => {
      const s = createServer().listen(0, "127.0.0.1", () => {
        const port = (s.address() as { port: number }).port
        s.close(() => resolve(port))
      })
    })

  async function call(body: Record<string, unknown>, key = API_KEY) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({ action: "update_person", ...body }),
    })
    return { status: res.status, body: (await res.json()) as Record<string, any> }
  }

  async function one<T = any>(sql: string, params: unknown[] = []): Promise<T> {
    const [rows] = await db.query(sql, params)
    return (rows as T[])[0]
  }

  async function insert(sql: string, params: unknown[]): Promise<number> {
    const [res] = await db.query(sql, params)
    return (res as mysql.ResultSetHeader).insertId
  }

  async function setting(table: "author_settings" | "user_settings", idCol: string, id: number, name: string) {
    const row = await one<{ v: string }>(`SELECT setting_value v FROM ${table} WHERE ${idCol} = ? AND setting_name = ?`, [id, name])
    return row?.v ?? null
  }

  beforeAll(async () => {
    const u = new URL(DB_URL!)
    db = await mysql.createConnection({
      host: u.hostname,
      port: Number(u.port || 3306),
      user: decodeURIComponent(u.username),
      password: decodeURIComponent(u.password),
      database: u.pathname.slice(1),
    })
    journalId = (await one<{ id: number }>("SELECT MIN(journal_id) id FROM journals")).id
    if (!journalId) throw new Error("the OJS test database has no journal to attach seed rows to")

    dir = mkdtempSync(path.join(tmpdir(), "ojs-bridge-"))
    copyFileSync(path.resolve(__dirname, "../../submit-manager-database-schema-ojs/ojs-user-bridge.php"), path.join(dir, "bridge.php"))
    writeFileSync(
      path.join(dir, "config.inc.php"),
      [
        "[database]",
        `host = "${u.hostname}"`,
        `port = ${u.port || 3306}`,
        `name = "${u.pathname.slice(1)}"`,
        `username = "${decodeURIComponent(u.username)}"`,
        `password = "${decodeURIComponent(u.password)}"`,
        "[digitopub]",
        `api_key = "${API_KEY}"`,
      ].join("\n")
    )
    const port = await freePort()
    url = `http://127.0.0.1:${port}/bridge.php`
    server = spawn("php", [...PHP_ARGS, "-S",`127.0.0.1:${port}`, "-t", dir], { stdio: "ignore" })
    for (let i = 0; i < 50; i++) {
      try {
        await fetch(url, { method: "GET" })
        return
      } catch {
        await new Promise((r) => setTimeout(r, 100))
      }
    }
    throw new Error("php -S did not start")
  }, 20000)

  afterAll(async () => {
    server?.kill()
    if (dir) rmSync(dir, { recursive: true, force: true })
    await db?.end()
  })

  beforeEach(async () => {
    const now = "2026-10-30 12:00:00"
    const userId = await insert(
      "INSERT INTO users (username, password, email, date_registered) VALUES (?, 'x', ?, ?)",
      [`bt${Date.now() % 1e9}`, "alice@bridge-test.invalid", now]
    )
    ids.users.push(userId)
    for (const [name, value] of [["givenName", "Alice"], ["familyName", "Old"]]) {
      await insert("INSERT INTO user_settings (user_id, locale, setting_name, setting_value) VALUES (?, 'en', ?, ?)", [userId, name, value])
    }

    const submissionId = await insert("INSERT INTO submissions (context_id) VALUES (?)", [journalId])
    ids.submissions.push(submissionId)
    const pubs: number[] = []
    const dois: number[] = []
    for (const status of [3, 1]) {
      const doiId = await insert("INSERT INTO dois (context_id, doi, status) VALUES (?, ?, ?)", [journalId, `10.99999/bt.${Date.now()}.${status}`, status])
      const pubId = await insert("INSERT INTO publications (submission_id, doi_id) VALUES (?, ?)", [submissionId, doiId])
      dois.push(doiId)
      pubs.push(pubId)
    }
    ids.dois.push(...dois)
    ids.publications.push(...pubs)

    const author = async (pubId: number, email: string, given: string, family: string, orcid?: string) => {
      const id = await insert("INSERT INTO authors (email, publication_id, seq) VALUES (?, ?, 0)", [email, pubId])
      ids.authors.push(id)
      await insert("INSERT INTO author_settings (author_id, locale, setting_name, setting_value) VALUES (?, 'en', 'givenName', ?), (?, 'en', 'familyName', ?)", [id, given, id, family])
      if (orcid) await insert("INSERT INTO author_settings (author_id, locale, setting_name, setting_value) VALUES (?, '', 'orcid', ?)", [id, orcid])
      return id
    }
    // Alice is on both publications (once with different email case); Bob only on the second.
    const authorA1 = await author(pubs[0], "alice@bridge-test.invalid", "Alice", "Old")
    const authorA2 = await author(pubs[1], "Alice@Bridge-Test.invalid", "Alice", "Old")
    const authorB = await author(pubs[1], "bob@bridge-test.invalid", "Bob", "Other", ORCID_B)

    seed = { userId, pub1: pubs[0], pub2: pubs[1], doi1: dois[0], doi2: dois[1], authorA1, authorA2, authorB }
  })

  afterEach(async () => {
    if (ids.authors.length) {
      await db.query("DELETE FROM author_settings WHERE author_id IN (?)", [ids.authors])
      await db.query("DELETE FROM authors WHERE author_id IN (?)", [ids.authors])
    }
    if (ids.publications.length) await db.query("DELETE FROM publications WHERE publication_id IN (?)", [ids.publications])
    if (ids.dois.length) await db.query("DELETE FROM dois WHERE doi_id IN (?)", [ids.dois])
    if (ids.submissions.length) await db.query("DELETE FROM submissions WHERE submission_id IN (?)", [ids.submissions])
    if (ids.users.length) {
      await db.query("DELETE FROM user_settings WHERE user_id IN (?)", [ids.users])
      await db.query("DELETE FROM users WHERE user_id IN (?)", [ids.users])
    }
    for (const k of Object.keys(ids) as (keyof typeof ids)[]) ids[k] = []
  })

  it("refuses a wrong key", async () => {
    const res = await call({ match_email: "alice@bridge-test.invalid", dry_run: true }, "wrong-key")
    expect(res.status).toBe(403)
  })

  it("reports the current values and counts for a dry run without changes", async () => {
    const res = await call({ match_email: "ALICE@bridge-test.invalid", dry_run: true })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      success: true,
      dry_run: true,
      account: { user_id: seed.userId },
      bylines: 2,
      publications: 2,
      changed_publications: 0,
      dois_marked_stale: 0,
      before: { givenName: "Alice", familyName: "Old", email: "alice@bridge-test.invalid", orcid: null },
    })
  })

  it("returns 404 for an unknown email", async () => {
    const res = await call({ match_email: "nobody@bridge-test.invalid", familyName: "X" })
    expect(res.status).toBe(404)
    expect(res.body.code).toBe("not_found")
  })

  it("updates the account and every byline in one go, and marks only registered DOIs stale", async () => {
    const res = await call({ match_email: "alice@bridge-test.invalid", familyName: "New", orcid: "0000-0002-1825-0097" })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      dry_run: false,
      changed_publications: 2,
      dois_marked_stale: 1,
      after: { givenName: "Alice", familyName: "New", orcid: ORCID_A },
    })
    expect(await setting("user_settings", "user_id", seed.userId, "familyName")).toBe("New")
    expect(await setting("user_settings", "user_id", seed.userId, "orcid")).toBe(ORCID_A)
    for (const id of [seed.authorA1, seed.authorA2]) {
      expect(await setting("author_settings", "author_id", id, "familyName")).toBe("New")
      expect(await setting("author_settings", "author_id", id, "orcid")).toBe(ORCID_A)
    }
    // Bob is untouched.
    expect(await setting("author_settings", "author_id", seed.authorB, "familyName")).toBe("Other")
    // Registered (3) -> stale (5); unregistered (1) stays.
    expect((await one("SELECT status FROM dois WHERE doi_id = ?", [seed.doi1])).status).toBe(5)
    expect((await one("SELECT status FROM dois WHERE doi_id = ?", [seed.doi2])).status).toBe(1)
  })

  it("does not write anything on a dry run with changes", async () => {
    const res = await call({ match_email: "alice@bridge-test.invalid", familyName: "New", email: "alice2@bridge-test.invalid", dry_run: true })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ dry_run: true, changed_publications: 2, dois_marked_stale: 1 })
    expect(await setting("author_settings", "author_id", seed.authorA1, "familyName")).toBe("Old")
    expect((await one("SELECT email FROM users WHERE user_id = ?", [seed.userId])).email).toBe("alice@bridge-test.invalid")
    expect((await one("SELECT status FROM dois WHERE doi_id = ?", [seed.doi1])).status).toBe(3)
  })

  it("changes the email on the account and all bylines", async () => {
    const res = await call({ match_email: "alice@bridge-test.invalid", email: "alice.new@bridge-test.invalid" })
    expect(res.status).toBe(200)
    expect((await one("SELECT email FROM users WHERE user_id = ?", [seed.userId])).email).toBe("alice.new@bridge-test.invalid")
    const [rows] = await db.query("SELECT email FROM authors WHERE author_id IN (?)", [[seed.authorA1, seed.authorA2]])
    expect((rows as { email: string }[]).map((r) => r.email)).toEqual(["alice.new@bridge-test.invalid", "alice.new@bridge-test.invalid"])
    expect((await call({ match_email: "alice@bridge-test.invalid", dry_run: true })).status).toBe(404)
  })

  it("refuses an email that belongs to someone else", async () => {
    const res = await call({ match_email: "alice@bridge-test.invalid", email: "BOB@bridge-test.invalid" })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe("email_in_use")
    expect((await one("SELECT email FROM users WHERE user_id = ?", [seed.userId])).email).toBe("alice@bridge-test.invalid")
  })

  it("refuses an ORCID iD that belongs to someone else", async () => {
    const res = await call({ match_email: "alice@bridge-test.invalid", orcid: ORCID_B, familyName: "New" })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe("orcid_in_use")
    expect(await setting("author_settings", "author_id", seed.authorA1, "familyName")).toBe("Old")
  })

  it("refuses an ORCID iD with a wrong check digit", async () => {
    const res = await call({ match_email: "alice@bridge-test.invalid", orcid: "0000-0002-1825-0098" })
    expect(res.status).toBe(400)
    expect(res.body.code).toBe("invalid_orcid")
  })

  it("removes the ORCID iD when given null", async () => {
    await call({ match_email: "bob@bridge-test.invalid", orcid: null })
    expect(await setting("author_settings", "author_id", seed.authorB, "orcid")).toBeNull()
  })

  it("refuses to change records with different names under one email unless same_person is set", async () => {
    // A co-author entered under Alice's address (common in OJS submissions).
    const coId = await insert("INSERT INTO authors (email, publication_id, seq) VALUES (?, ?, 1)", ["alice@bridge-test.invalid", seed.pub2])
    ids.authors.push(coId)
    await insert("INSERT INTO author_settings (author_id, locale, setting_name, setting_value) VALUES (?, 'en', 'givenName', 'Carol'), (?, 'en', 'familyName', 'Co')", [coId, coId])

    const lookup = await call({ match_email: "alice@bridge-test.invalid", dry_run: true })
    expect(lookup.status).toBe(200)
    expect(lookup.body.names).toEqual(["Alice Old", "Carol Co"])

    const refused = await call({ match_email: "alice@bridge-test.invalid", familyName: "New" })
    expect(refused.status).toBe(409)
    expect(refused.body).toMatchObject({ code: "ambiguous_person", names: ["Alice Old", "Carol Co"] })
    expect(await setting("author_settings", "author_id", coId, "familyName")).toBe("Co")

    const confirmed = await call({ match_email: "alice@bridge-test.invalid", familyName: "New", same_person: true })
    expect(confirmed.status).toBe(200)
    expect(await setting("author_settings", "author_id", coId, "familyName")).toBe("New")
  })

  it("drops the ORCID plugin's settings for the old iD when the iD changes", async () => {
    await insert("INSERT INTO author_settings (author_id, locale, setting_name, setting_value) VALUES (?, '', 'orcidAccessToken', 'tok')", [seed.authorB])
    const res = await call({ match_email: "bob@bridge-test.invalid", orcid: ORCID_A.replace("https://orcid.org/", "") })
    expect(res.status).toBe(200)
    expect(await setting("author_settings", "author_id", seed.authorB, "orcidAccessToken")).toBeNull()
    expect(await setting("author_settings", "author_id", seed.authorB, "orcid")).toBe(ORCID_A)
  })

  it("finds an ORCID clash stored in another URL form", async () => {
    await db.query("UPDATE author_settings SET setting_value = ? WHERE author_id = ? AND setting_name = 'orcid'", [
      ORCID_B.replace("https://", "http://"),
      seed.authorB,
    ])
    const res = await call({ match_email: "alice@bridge-test.invalid", orcid: ORCID_B })
    expect(res.status).toBe(409)
    expect(res.body.code).toBe("orcid_in_use")
  })

  it("refuses empty given names, control characters and 4-byte characters", async () => {
    for (const bad of [{ givenName: "" }, { familyName: "a\u0007b" }, { familyName: "Old 😀" }]) {
      const res = await call({ match_email: "alice@bridge-test.invalid", ...bad })
      expect(res.status).toBe(400)
    }
  })
})
