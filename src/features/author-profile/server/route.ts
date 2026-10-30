/**
 * Admin editing of an author's name, email and ORCID iD in OJS (#233).
 * Mounted at /api/author-profile; every route requires an admin.
 */

import { Hono, type Context } from "hono"
import { zValidator } from "@hono/zod-validator"
import { z } from "zod"
import { requireAdmin } from "@/src/lib/auth-middleware"
import { previewPersonUpdate } from "@/src/lib/ojs-write-guard"
import { adminPersonEditSchema } from "../schemas/person-edit"
import { applyPersonEdit, messageForCode, statusForCode } from "./service"

function actorId(c: Context): bigint | null {
  const session = c.get("session") as { id?: string } | undefined
  return session?.id && /^\d+$/.test(session.id) ? BigInt(session.id) : null
}

const app = new Hono()
  .use("*", requireAdmin)

  /** Current values and record counts for one author (bridge dry run, no changes). */
  .get("/person", zValidator("query", z.object({ email: z.string().trim().email().max(255) })), async (c) => {
    const result = await previewPersonUpdate(c.req.valid("query").email)
    if (!result.success) {
      return c.json({ success: false, error: messageForCode(result.code), code: result.code }, statusForCode(result.code))
    }
    const { success: _s, auditId: _a, ...data } = result
    return c.json({ success: true, data })
  })

  /** What saving would change, without writing (bridge dry run). */
  .post("/person/preview", zValidator("json", adminPersonEditSchema), async (c) => {
    const { matchEmail, ...changes } = c.req.valid("json")
    const result = await previewPersonUpdate(matchEmail, changes)
    if (!result.success) {
      return c.json({ success: false, error: messageForCode(result.code), code: result.code }, statusForCode(result.code))
    }
    const { success: _s, auditId: _a, ...data } = result
    return c.json({ success: true, data })
  })

  /** Save: names/ORCID now; a new email after its owner confirms it. */
  .post("/person", zValidator("json", adminPersonEditSchema), async (c) => {
    const { matchEmail, ...changes } = c.req.valid("json")
    const outcome = await applyPersonEdit({ matchEmail, changes, actor: { adminId: actorId(c) } })
    if (!outcome.ok) {
      return c.json({ success: false, error: outcome.error, code: outcome.code }, outcome.status)
    }
    return c.json({
      success: true,
      data: { applied: outcome.applied, confirmationSentTo: outcome.confirmationSentTo },
    })
  })

export { app as authorProfileRouter }
