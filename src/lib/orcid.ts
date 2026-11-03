const ORCID_ID_RE = /^(?:(?:https?:\/\/)?orcid\.org\/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\/?$/i

/**
 * Returns the bare ORCID iD ("0000-0002-1825-0097") from a byline value,
 * which OJS stores either bare or as an orcid.org URL, or null when the
 * value is not a well-formed iD (#263).
 */
export function normalizeOrcidId(value: string | null | undefined): string | null {
  const match = value?.trim().match(ORCID_ID_RE)
  return match ? match[1].toUpperCase() : null
}

export function orcidProfileUrl(id: string): string {
  return `https://orcid.org/${id}`
}
