/**
 * Pure helpers behind the landing page's interactive parts, kept out of the
 * component files so Fast Refresh keeps working (react-refresh lint rule).
 */

/** A common drum size, used only to help people picture a keke load. */
export const DRUM_LITRES = 200

const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾' }

/** "1½": litres as 200 L drums, with quarters written as fractions. */
export function drumsLabel(litres: number): string {
  const drums = litres / DRUM_LITRES
  const whole = Math.floor(drums)
  const frac = +(drums - whole).toFixed(2)
  if (!frac) return String(whole)
  const f = FRACTIONS[String(frac)]
  return f ? `${whole || ''}${f}` : drums.toFixed(1)
}

/** Letters only, lower case: "Trans Ekulu", "trans-ekulu" and "TRANSEKULU" all match. */
const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '')

/**
 * The listed areas whose name contains the search, or that the search
 * contains (so "GRA Enugu" finds "GRA"). Empty search matches nothing.
 */
export function matchAreas(areas: string[], search: string): string[] {
  const q = norm(search)
  if (!q) return []
  return areas.filter((a) => {
    const name = norm(a)
    return name.includes(q) || (q.length > 2 && q.includes(name))
  })
}
