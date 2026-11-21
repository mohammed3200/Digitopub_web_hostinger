import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { client } from "@/src/lib/rpc"
import type {
  SpecializationItem,
  SpecializationSyncStatus,
} from "../schemas/specialization-schema"
import type { CustomDetail } from "../custom-details"

interface ApiEnvelope<T> {
  success: boolean
  data?: T
  message?: string
  error?: string
}

export interface JournalSpecializationResult {
  journal_id: string
  field: string
  sync: SpecializationSyncStatus
}

export interface SpecializationUpdateResult {
  specialization: SpecializationItem
  journals_updated: number
}

const KEY = "journal-specializations"

/** Unwraps `{ success, data }`; throws the API `error` string otherwise. */
async function unwrap<T>(response: Response, fallback: string): Promise<ApiEnvelope<T> & { data: T }> {
  let json: ApiEnvelope<T> | null = null
  try {
    json = (await response.json()) as ApiEnvelope<T>
  } catch {
    json = null
  }
  if (!response.ok || !json || json.success === false || json.data === undefined) {
    throw new Error(json?.error || fallback)
  }
  return json as ApiEnvelope<T> & { data: T }
}

function invalidateAll(queryClient: QueryClient) {
  queryClient.invalidateQueries({ queryKey: [KEY] })
  queryClient.invalidateQueries({ queryKey: ["journals"] })
}

/** Active specializations (public). */
export function useGetSpecializations() {
  return useQuery({
    queryKey: [KEY, "active"],
    queryFn: async (): Promise<SpecializationItem[]> => {
      const res = await client.journals.specializations.$get()
      return (await unwrap<SpecializationItem[]>(res, "Failed to load specializations")).data
    },
    staleTime: 60 * 1000,
  })
}

/** All specializations including retired (admin). */
export function useGetManagedSpecializations() {
  return useQuery({
    queryKey: [KEY, "manage"],
    queryFn: async (): Promise<SpecializationItem[]> => {
      const res = await client.journals.specializations.manage.$get()
      return (await unwrap<SpecializationItem[]>(res, "Failed to load specializations")).data
    },
  })
}

/** OJS sync status keyed by digitopub journal id (admin). */
export function useGetSpecializationSyncStatus() {
  return useQuery({
    queryKey: [KEY, "sync-status"],
    queryFn: async (): Promise<Record<string, SpecializationSyncStatus>> => {
      const res = await client.journals.specializations["sync-status"].$get()
      return (await unwrap<Record<string, SpecializationSyncStatus>>(res, "Failed to load sync status")).data
    },
    refetchInterval: 60 * 1000,
  })
}

export interface JournalSpecializationDetail {
  journal_id: string
  title: string
  field: string
  ojs_id: string | null
  ojs_path: string | null
  invitation_scope: string | null
  custom_details: CustomDetail[]
  sync: SpecializationSyncStatus
}

/**
 * One journal by its numeric digitopub id (admin edit page). Deliberately not
 * useGetJournal(id): the public route resolves ojs_id before the numeric id,
 * which can return a different journal when the two id spaces overlap.
 */
export function useGetJournalSpecialization(journalId: string) {
  return useQuery({
    queryKey: [KEY, "journal", journalId],
    queryFn: async (): Promise<JournalSpecializationDetail> => {
      const res = await client.journals[":id"].specialization.$get({ param: { id: journalId } })
      return (await unwrap<JournalSpecializationDetail>(res, "Failed to load journal")).data
    },
    enabled: /^\d+$/.test(journalId),
    refetchInterval: (query) => query.state.data?.sync.state === "pending" ? 15_000 : false,
  })
}

/** Re-send every linked journal's specialization to OJS (go-live backfill). */
export function usePushAllSpecializations() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (): Promise<{ queued: number; synced: number; pending: number; failed: number }> => {
      const res = await client.journals.specializations["push-all"].$post()
      return (await unwrap<{ queued: number; synced: number; pending: number; failed: number }>(res, "Failed to push to OJS")).data
    },
    onSuccess: ({ queued, synced, pending, failed }) => {
      const detail = `${synced} synced` + (pending ? `, ${pending} will retry` : "") + (failed ? `, ${failed} failed` : "")
      if (pending || failed) toast.warning(`Sent ${queued} journals to OJS: ${detail}`)
      else toast.success(`Sent ${queued} journals to OJS: ${detail}`)
      invalidateAll(queryClient)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useCreateSpecialization() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (input: { name: string; sort_order?: number }): Promise<SpecializationItem> => {
      const res = await client.journals.specializations.$post({ json: input })
      return (await unwrap<SpecializationItem>(res, "Failed to add specialization")).data
    },
    onSuccess: (item) => {
      toast.success(`Added "${item.name}"`)
      invalidateAll(queryClient)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useUpdateSpecialization() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      ...json
    }: {
      id: string
      name?: string
      sort_order?: number
      is_active?: boolean
    }): Promise<SpecializationUpdateResult & { renamed: boolean }> => {
      const res = await client.journals.specializations[":specId"].$patch({
        param: { specId: id },
        json,
      })
      const { data } = await unwrap<SpecializationUpdateResult>(res, "Failed to update specialization")
      return { ...data, renamed: json.name !== undefined }
    },
    onSuccess: (result) => {
      if (result.renamed) {
        const n = result.journals_updated
        toast.success(
          n > 0
            ? `Renamed; ${n} journal${n === 1 ? "" : "s"} updated; OJS sync queued`
            : "Renamed; no journals were using this name"
        )
      } else {
        toast.success("Specialization updated")
      }
      invalidateAll(queryClient)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useSetJournalSpecialization() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ journalId, name }: { journalId: string; name: string }): Promise<JournalSpecializationResult> => {
      const res = await client.journals[":id"].specialization.$put({
        param: { id: journalId },
        json: { name },
      })
      return (await unwrap<JournalSpecializationResult>(res, "Failed to update specialization")).data
    },
    onSuccess: (result) => {
      const state = result.sync.state
      if (state === "synced") toast.success("Specialization saved and synced to OJS")
      else if (state === "pending") toast.warning("Specialization saved; OJS sync will retry automatically")
      else if (state === "failed") toast.error("Specialization saved, but the OJS sync failed")
      else toast.success("Specialization saved")
      invalidateAll(queryClient)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

export function useRetrySpecializationSync() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (journalId: string): Promise<SpecializationSyncStatus> => {
      const res = await client.journals[":id"].specialization.retry.$post({ param: { id: journalId } })
      return (await unwrap<SpecializationSyncStatus>(res, "Failed to retry sync")).data
    },
    onSuccess: (sync) => {
      if (sync.state === "synced") toast.success("Synced to OJS")
      else toast.warning("Retry did not complete; see sync status for details")
      invalidateAll(queryClient)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

/** Saves the scope sentence used in this journal's alert invitation (#231); blank clears it. */
export function useUpdateInvitationScope() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ journalId, scope }: { journalId: string; scope: string }): Promise<unknown> => {
      const res = await client.journals[":id"].$patch({ param: { id: journalId }, json: { invitation_scope: scope } })
      return (await unwrap<unknown>(res, "Failed to save the invitation text")).data
    },
    onSuccess: () => {
      toast.success("Invitation text saved")
      invalidateAll(queryClient)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}

/** Saves the custom fields shown in the public Journal Details card (#281); [] clears them. */
export function useUpdateCustomDetails() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ journalId, details }: { journalId: string; details: CustomDetail[] }): Promise<unknown> => {
      const res = await client.journals[":id"].$patch({ param: { id: journalId }, json: { custom_details: details } })
      return (await unwrap<unknown>(res, "Failed to save the custom fields")).data
    },
    onSuccess: () => {
      toast.success("Journal details saved")
      invalidateAll(queryClient)
    },
    onError: (error: Error) => toast.error(error.message),
  })
}
