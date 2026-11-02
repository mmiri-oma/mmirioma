# "Use my location" (Google Maps)

Status: built on `feat/waterline-redesign` (2026-11-02). Not deployed. Needs
a Google Maps browser key and the team's approval of Google Maps as a new
service.

## 1. Overview and purpose

Helps people say where they are without typing: on the website's area check
("Do we deliver to you?") and on the customer app's address forms. The
browser's location, named by Google Maps (reverse geocoding), becomes an
address and an area suggestion. SRS FR-020 allows an optional map pin; this
is the first step towards it.

## 2. Feature workflow

- **Website** (`/`, header "Check your area" and hero "Do you deliver to
  me?"): the area check opens in a pop-up. "Use my location" asks the browser
  for permission, finds the position, asks Google for the address and the
  neighbourhood names, and puts the first name that is on the area list into
  the search. If none is on the list it says "We found you near …. That is
  not on our list yet. Call us and we will check."
- **App** (`/addresses/new`, `/addresses/:id/edit`, and the new-address part
  of `/order/details`): "Use my location" shows what it found on a small map
  with "Use this address" and "Not right". "Use this address" fills the
  delivery address and picks the matching area from `GET /service-zones`
  when one matches; the customer can still change both.
- Failures (permission refused, no GPS, time-out, Maps not loading) say what
  happened and that typing still works; the button offers to try again.

## 3. Important files

| Path | Responsibility |
| --- | --- |
| `frontend/src/lib/maps.ts` | Key check, Google Maps loader, `currentPosition`, `placeNamesFrom`, `findMyLocation`, `LocationError` |
| `frontend/src/components/ui/UseMyLocation.tsx` | The button, result card and `MapPreview` |
| `frontend/src/features/marketing/landing/AreaCheck.tsx`, `AreaCheckDialog.tsx` | The area check and its pop-up (header, hero, phone menu) |
| `frontend/src/features/customer/order/locationArea.ts` | `areaForPlaces`: place names to a listed area |
| `frontend/src/features/customer/pages/AddressForm.tsx`, `order/DeliveryDetails.tsx` | Where the app uses it |

## 4. Database models and relationships

None. The position is not stored: saved addresses have no coordinates yet.

## 5. API endpoints and request/response behavior

None of ours change. The app still sends the typed address and the chosen
`zone_id` as before (docs/api/customer-account.md, order-details-and-price.md).
In the browser: Google Maps JavaScript API (`maps.googleapis.com/maps/api/js`)
and its Geocoder.

## 6. Important business rules

- The area is a suggestion; the server decides from the area the customer
  submits (FR-010, FR-020). Nothing works out a zone from coordinates.
- Location only after the person taps the button and the browser permission
  is given; never on page load, never in the background.
- The position is not saved or sent to our server; it goes to Google only to
  name the place (privacy notice sections 5 and 7, version 3.1).
- Analytics records only that the button was used and whether it worked or
  matched, never the position or address.

## 7. Authentication and authorization

Website: public. App: the address screens' existing customer sign-in.

## 8. Error handling and edge cases

- No `VITE_GOOGLE_MAPS_API_KEY`: the button is hidden; everything else works.
- Permission refused, no GPS or time-out: a message and "Try my location again".
- Maps script fails: "Maps could not load"; a later tap tries again.
- Google finds nothing: "We could not name the place you are in".
- The map preview failing on its own is silent; the address text still shows.

## 9. Testing instructions

```bash
cd frontend
npx vitest run src/lib/maps.test.ts src/components/ui/UseMyLocation.test.tsx src/features/customer/order/locationArea.test.ts src/features/marketing/marketing.test.tsx
```

Manual: put a restricted key in `frontend/.env.local` as
`VITE_GOOGLE_MAPS_API_KEY`, enable the Maps JavaScript API and the Geocoding
API on it, open `/` and an address form on a phone, and allow location.

## 10. Known limitations

- Google Maps is a new external service: it needs the team's approval
  (`CLAUDE.md`) and a Google Cloud project with billing. The admin-directory
  contract decided "no map provider" for the pilot (open questions 5 and 6);
  this changes that for the customer side only.
- No map pin is saved with an address, so road-distance pricing (OSRM, FR-022)
  cannot use it yet; that needs a contract and migration (coordinates on
  addresses).
- The website's area list is still the sample list from `content.ts`, not
  the server's zones.
- The marker uses `google.maps.Marker`, which Google is replacing with
  Advanced Markers (needs a Map ID).
