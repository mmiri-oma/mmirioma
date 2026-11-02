/**
 * Turn the place names Google Maps found ("Use my location") into one of the
 * areas the server lists. Only a suggestion: the customer can still change
 * the area, and the server decides from the area they submit (FR-010,
 * FR-020); nothing here works out a zone from coordinates.
 */
import { matchAreas } from '../../marketing/landing/logic'

/**
 * The first listed area matching a place name, trying the most specific name
 * first (a neighbourhood before the town).
 *
 * @param areas - The areas from `GET /service-zones`.
 * @param placeNames - Place names from `findMyLocation()`, most specific first.
 * @returns The matching area, or `null` when none matches.
 */
export function areaForPlaces<T extends { name: string }>(areas: T[], placeNames: string[]): T | null {
  const names = areas.map((a) => a.name)
  for (const place of placeNames) {
    const hit = matchAreas(names, place)[0]
    if (hit) return areas.find((a) => a.name === hit) ?? null
  }
  return null
}
