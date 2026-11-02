/**
 * Ends the public (ORCID) identity session. Resolves true only when the
 * server confirmed it (2xx); a non-2xx response or a network error resolves
 * false, so the caller keeps the signed-in UI and the user can retry (#260).
 */
export async function signOutOrcid(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("/api/auth/orcid/logout", { method: "POST", credentials: "same-origin" })
    return res.ok
  } catch {
    return false
  }
}
