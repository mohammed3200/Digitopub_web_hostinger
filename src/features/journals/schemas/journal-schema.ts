import { z } from "zod"
import { customDetailsSchema } from "../custom-details"

const journalBaseSchema = z.object({
  title: z.string().min(1, "Title is required").max(500),
  abbreviation: z.string().max(100).optional().nullable(),
  issn: z.string().max(20).optional().nullable(),
  e_issn: z.string().max(20).optional().nullable(),
  description: z.string().optional().nullable(),
  field: z.string().min(1, "Field is required").max(100),
  publisher: z.string().max(255).optional().nullable(),
  editor_in_chief: z.string().max(255).optional().nullable(),
  frequency: z.string().max(50).optional().nullable(),
  submission_fee: z.coerce.number().nonnegative(),
  publication_fee: z.coerce.number().nonnegative(),
  cover_image_url: z.url().optional().nullable(),
  website_url: z.url().optional().nullable(),
  status: z.enum(["active", "inactive", "suspended"]),
  // #231: scope sentence for the journal's alert invitation; blank clears it.
  invitation_scope: z.string().trim().max(500).transform((v) => v || null).optional().nullable(),
  // #281: custom label/value pairs for the public Journal Details card; [] clears them.
  custom_details: customDetailsSchema.optional(),
})

// invitation_scope (#231) and custom_details (#281) are set on the edit page only, so create does not accept them.
export const journalCreateSchema = journalBaseSchema.omit({ invitation_scope: true, custom_details: true }).extend({
  submission_fee: journalBaseSchema.shape.submission_fee.optional().default(0),
  publication_fee: journalBaseSchema.shape.publication_fee.optional().default(0),
  status: journalBaseSchema.shape.status.optional().default("active"),
})

// Built from the base, not the create schema: zod 4 still applies .default()
// inside .partial(), so a title-only PATCH would reset fees and status.
// `field` is omitted because it changes through PUT /journals/:id/specialization,
// which validates it against the managed list and syncs it to OJS (#234).
export const journalUpdateSchema = journalBaseSchema.omit({ field: true }).partial()

export const journalIdParamSchema = z.object({
  id: z.string().regex(/^\d+$/, "Invalid journal ID"),
})

/** Accepts any string identifier: ojs_path slug, ojs_id, or numeric id */
export const journalSlugParamSchema = z.object({
  id: z.string().trim().min(1, "Journal identifier is required").max(100, "Journal identifier must be at most 100 characters"),
})

export type JournalCreate = z.infer<typeof journalCreateSchema>
export type JournalUpdate = z.infer<typeof journalUpdateSchema>
