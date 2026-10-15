// `MO-` + 10 Crockford base32 characters (docs/api/orders.md, FR-027).
const REFERENCE_PATTERN = /^MO-[0-9A-HJKMNP-TV-Z]{10}$/

/**
 * Normalise a reference a dispatcher types or hears over the phone: trims,
 * removes spaces, upper-cases and adds the `MO-` prefix if it was left off.
 *
 * @returns The normalised reference, or `null` if it is not a valid format.
 */
export function normaliseReference(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/\s+/g, '')
  const reference = compact.startsWith('MO-') ? compact : `MO-${compact.replace(/^MO/, '')}`
  return REFERENCE_PATTERN.test(reference) ? reference : null
}
