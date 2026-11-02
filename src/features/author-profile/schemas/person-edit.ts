import { z } from "zod"

const name = z.string().trim().max(255)
// OJS authors.email is varchar(90).
const email = z.string().trim().email().max(90)

/** Admin edit of any author (#233). Omitted fields stay as they are. */
export const adminPersonEditSchema = z.object({
  /** The author's current email: identifies their OJS account and every byline. */
  matchEmail: z.string().trim().email().max(255),
  givenName: name.min(1).optional(),
  familyName: name.optional(),
  email: email.optional(),
  /** "0000-0002-1825-0097" or the https://orcid.org/ form; null removes it. */
  orcid: z.string().trim().max(60).nullable().optional(),
  /** The admin confirmed that differently named records under matchEmail are one person. */
  samePerson: z.boolean().optional(),
})

/** Look up one author (POST, so the email stays out of access logs). */
export const personLookupSchema = z.object({
  email: z.string().trim().email().max(255),
})

/** Self-service edit by the signed-in author (#233). The ORCID iD can only be their own. */
export const selfPersonEditSchema = z.object({
  givenName: name.min(1).optional(),
  familyName: name.optional(),
  email: email.optional(),
  /** Put the signed-in, OAuth-verified ORCID iD on the record. */
  linkOrcid: z.boolean().optional(),
})

export const confirmEmailSchema = z.object({
  token: z.string().min(20).max(100),
})

export type AdminPersonEdit = z.infer<typeof adminPersonEditSchema>
export type SelfPersonEdit = z.infer<typeof selfPersonEditSchema>
