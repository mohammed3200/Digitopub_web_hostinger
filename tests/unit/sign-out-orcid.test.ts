import { describe, expect, it, vi } from "vitest"
import { signOutOrcid } from "@/src/features/auth/utils/sign-out-orcid"

describe("signOutOrcid (#260)", () => {
  it("posts to the ORCID logout route and succeeds on 2xx", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }))
    await expect(signOutOrcid(fetchImpl)).resolves.toBe(true)
    expect(fetchImpl).toHaveBeenCalledWith("/api/auth/orcid/logout", { method: "POST", credentials: "same-origin" })
  })

  it("fails on a non-2xx response", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response("{}", { status: 500 }))
    await expect(signOutOrcid(fetchImpl)).resolves.toBe(false)
  })

  it("fails on a network error instead of throwing", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"))
    await expect(signOutOrcid(fetchImpl)).resolves.toBe(false)
  })
})
