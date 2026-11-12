# Maps, address search and road distance (proposal)

**Status: approved by the design reviewer on 2 November 2026, with
conditions** (section 10), and the budget holder agreed the $0 ceiling on
2 November 2026. Map work (#340, #345, #346) follows the approved options and
the conditions. Issue [#334](https://github.com/mmiri-oma/mmirioma/issues/334)
is complete once this change merges.

**Author:** @nnamdi-security + agent · **Written:** 2 November 2026 · **Prices
and terms checked:** 2 November 2026 (section 11 lists each source).

CLAUDE.md forbids new libraries, services and infrastructure without approval,
so this document asks for three decisions, each with 2 to 4 options:

1. The map library and where the map tiles come from (section 3).
2. Address search, also called geocoding (section 4).
3. Where OSRM runs, the open item in SRS §12.1 (section 5).

No code and no dependency is added by this issue.

> **12 November 2026:** #408 proposes an external routing provider instead of R1. See [provider research](routing-provider-408.md) and the [contract proposal](../api/road-pricing-and-eta.md). This is not approval or activation of the replacement; the historical decision and conditions below remain recorded.

## 1. Summary of the recommendation

| Decision | Recommended option | Monthly cost | Main risk |
| --- | --- | --- | --- |
| Map library and tiles | **MapLibre GL JS** with the **OpenFreeMap** public tiles (option M1) | $0 | No uptime promise (a donation-funded service). The tile address is configuration, so switching provider is a config change |
| Address search | **No hosted geocoder in the pilot** (option G1): the customer types the address, uses device location, and moves a pin. A paid geocoder is a later switch (G2) | $0 | The customer gets no "type to search" suggestions |
| OSRM hosting | **On the existing Hostinger VPS**, as one memory-limited container, with its map data built off the server (option R1) | $0 extra | Memory on a 4 GB machine is **not yet measured**. If the measurement fails, OSRM is not deployed and every order uses delivery-zone rates until there is budget for a second small VPS (R2) |

Total recommended: **$0 a month of new spend**. The owner said on
2 November 2026 that there is **no budget** and the most cost-effective option
is wanted, so the ceiling is **$0** and every paid option below is excluded
until a budget exists. If a recommendation fails its test, the zero-cost
fallback is to run without it (section 6), not to buy a replacement; the paid
replacements are listed in section 7 only so the team can see their price.

The budget holder confirmed the $0 ceiling in a comment on #334 (linked in
section 10).

## 2. What the SRS already fixes

These are not options.

- **OSRM** supplies the road distance used in the quote (FR-022, SRS §12.1).
  **Straight-line distance is never used for delivery pricing** (FR-022).
- When OSRM cannot return a distance, the delivery cost falls back to the
  delivery zone's admin-configured rates (FR-010), or the order becomes a
  manual quote. No fabricated route estimates (FR-022, SRS §8 "Road distance
  unavailable", test T-18).
- A map pin is **optional**. A customer who gives no pin still orders, and the
  zone rates apply (FR-020).
- The deployment is one Hostinger KVM 1 VPS: 1 vCPU, 4 GB RAM, 50 GB disk
  ([hostinger.md](../deployment/hostinger.md)).
- Money is integer kobo; the map choice changes no money rule.

Pilot size. The PRD gives no order volume (it describes a one-neighbourhood
pilot that tests fulfilment, not scale), so this document costs three
**assumed** scenarios, labelled as assumptions and not forecasts:

| Scenario | Orders a month | Assumed use per order |
| --- | --- | --- |
| Low | 100 | 1 map session of about 40 tiles; 3 quotes (3 OSRM calls); 3 address searches |
| Medium | 1,000 | same |
| High | 10,000 | same |

The per-order figures are my assumptions. They are what the cost lines below
use; replace them when the pilot gives real numbers.

## 3. Map library and tiles

The map is only an aid for placing a pin (customer address, #345) and for
showing service areas (landing page, #346). Ordering never depends on it.

| | M1: MapLibre GL JS + OpenFreeMap | M2: MapLibre GL JS + Stadia Maps (Starter) | M3: MapLibre GL JS + MapTiler (Flex) | M4: public OpenStreetMap tile server |
| --- | --- | --- | --- | --- |
| Monthly cost, all three scenarios | $0 | $20 (Starter: 1,000,000 credits, 1 credit per tile; about 25,000 sessions at 40 tiles; the High scenario uses about 400,000 credits, so it fits; overage would be 3¢ per 1,000 credits) | $30 (Flex: 25,000 sessions, 500,000 requests) | $0 |
| Licence and attribution | Library BSD-3-Clause. Tiles: commercial use allowed. MapLibre adds the OpenFreeMap, OpenMapTiles and OpenStreetMap attribution itself | Commercial use needs the paid plan (the free plan is non-commercial). Attribution rules are on a page I could not read; unverified | The free plan is for testing and non-commercial use, so commercial needs Flex. Logo required on free; on Flex only for 3D | OpenStreetMap attribution must be clearly visible on the map |
| Fit for production | Yes, by its FAQ ("commercial usage allowed"); **no SLA, no support** | Yes | Yes | **No.** "No SLA or guarantee"; heavy use is forbidden and access "may be withdrawn at any point" for commercial services |
| What it receives | The customer's IP address and the tile addresses requested (so, roughly, the area looked at). Not the typed address. Its logging policy was not readable; **a reviewer must read the privacy policy before approval** | Same, plus an account and an API key (public in the browser) | Same, plus an account and an API key (public in the browser) | Same |
| Nigeria coverage | OpenStreetMap data; Enugu streets and neighbourhoods exist (section 4) | OpenStreetMap-based | OpenStreetMap-based | OpenStreetMap |
| How it fails | Blank grey map. The address form still works | Same; an exhausted quota returns errors rather than charges | Same; the service halts at quota | Blocked without notice |

**Library choice.** MapLibre GL JS is the one library in all of M1 to M3. It
is open source (BSD 3-Clause) and reads vector tiles, which is why the
provider is a style address, not code. Leaflet, the other well-known option,
shows raster tiles only and would need paid raster tiles; I do not propose it.
Adding MapLibre is a **new frontend dependency**: this approval covers it, and
#345 and #346 add it with a lazy import so the landing page stays fast.

**Recommendation: M1.** It costs nothing at any scenario and allows commercial
use. Its weakness is no promise of uptime, which we can live with because the
map is optional (section 6). The tile style address is one configuration value
(`VITE_*`, public by design), so moving to M2 means changing that value, a
$20 monthly decision, without touching code. I would switch if OpenFreeMap
is unreliable during the pilot, or if the reviewer finds its logging policy
unacceptable.

Not proposed: self-hosting the tiles. It needs a vector-tile file and a tile
server on a 4 GB machine that is already tight, for a map that is optional.

## 4. Address search (geocoding)

**What I measured.** I sent 6 queries to the public Nominatim service (public
street and neighbourhood names only, 1 request every 2 seconds, with an
identifying User-Agent) on 2 November 2026:

| Query | Result |
| --- | --- |
| Ogui Road, Enugu | Found: 3 road results with postcode |
| Independence Layout, Enugu | Found: 3 suburb results |
| Chime Avenue, New Haven, Enugu | Found: 2 road results |
| Presidential Road, Enugu | Found: 3 road results |
| Ninth Mile Corner, Enugu | **Nothing found** (a well-known local landmark) |
| 15 Chime Avenue, New Haven, Enugu | Returned the **street only**, not the house |

So OpenStreetMap-based search finds streets and neighbourhoods in Enugu but
**does not resolve house numbers** and misses some landmarks. This is six
queries, not a coverage survey; I found no published measure of address
coverage for Enugu (the OSM wiki also records a quality warning about an
Enugu point-of-interest import). A paid geocoder built on the same data would
give the same limits. A provider with its own address data could do better,
but I did not find or test one with Nigerian coverage.

| | G1: no hosted geocoder | G2: Stadia Maps geocoding (Starter) | G3: public Nominatim | G4: self-hosted Nominatim or Photon |
| --- | --- | --- | --- | --- |
| Monthly cost | $0 | $20 (shared with M2; autocomplete v2 is 1 credit a request, forward geocoding 20 credits) | $0 | $0 licence, but another service and a data import on the VPS |
| Licence and rules | None | Commercial use needs the paid plan. Rules on storing results unverified | **Not allowed for this use**: maximum 1 request a second, autocomplete forbidden, may be withdrawn, no uptime guarantee | Open source; no usage limits |
| What it receives | Nothing | The text the customer types (an address is personal data) and their IP | Same | Nothing leaves our servers |
| How it fails | Not applicable | Search returns an error; the customer types the address | Blocked | Our own outage |

**Recommendation: G1 for the pilot.** The evidence above says a paid search
would not find the house, which is what a courier needs, so it would cost $20
a month to add suggestions that stop at the street. The flow is:

1. The customer types the address, landmark and instructions in the existing
   form (this is the data the order uses).
2. Optionally, "Use my location" asks the browser for the device position
   (only when the customer taps it, after an explanation; #345).
3. The map opens at the device position, or at the centre of the chosen
   service zone, and the customer moves the pin to their gate.

Where #345's design has a "searching" state, it covers the wait for the
device position (and the map loading), not text suggestions. The customer
chooses the delivery area from the real service zones, as today.

If the pilot shows customers cannot place the pin, the switch is G2 plus the
M2 plan, $20 a month for both (one plan covers tiles, search and routing
credits). That would need a new approval of this document.

G3 is excluded. G4 is excluded for the pilot: it is a second heavy service
for little coverage gain.

## 5. Where OSRM runs

Required by SRS §12.1. The routes OSRM answers are between a supplier source
and the delivery pin. The input to OSRM is two coordinates; no name, phone or
address text is sent.

**Map data size.** Geofabrik's `nigeria-latest.osm.pbf` is **680 MB**
(checked 2 November 2026, data up to 1 November 2026). The OSRM project
measured its car profile on the 61 GiB planet file at about 123 GiB of RAM and
about 415 GiB of disk for the extract step, and says size scales roughly
linearly with the input. **Extrapolating (my arithmetic, not a measurement):**
Nigeria is about 1% of the planet file, so roughly 1.3 GiB of RAM to serve
routes and about 4.5 GB of disk to build. Peak memory while building is higher
than serving, which is why the build should not run on the VPS.

| | R1: container on the existing VPS | R2: second small VPS | R3: hosted routing API (Stadia) | R4: OSRM public demo server |
| --- | --- | --- | --- | --- |
| Monthly cost | $0 extra | $6.49 for KVM 1 on a 24-month prepaid term; renews at $11.99 (list prices, vary by region and coupon) | $20 (Starter; routing is 20 credits a request, so even 10,000 orders x 3 quotes is 600,000 credits) | $0 |
| Is it OSRM? | Yes | Yes | **No**: Stadia routes with a different engine. The SRS names OSRM, so using it needs an SRS change | Yes |
| Rules | OSRM is open source (BSD-2). Map data is OpenStreetMap (ODbL), credit "© OpenStreetMap contributors" | Same | Commercial use needs the paid plan | **Not allowed** for a service: non-commercial, reasonable use, "no quality guarantees", access can be withdrawn at any time |
| Data privacy | Nothing leaves our servers | Nothing leaves our servers | Two coordinates per call go to a third party | Same as R3 |
| How it fails | A stopped container, or memory pressure on the API (the real risk, see below) | Only OSRM is affected | Provider outage | Blocked |
| Extra work | A container, a monthly data refresh, a memory limit | All of R1, plus a second server to secure and back up | An adapter for a different engine | None |

**Recommendation: R1, gated by a measurement.** The map data is small
and OSRM is a single static-file server. But the VPS has 4 GB for Postgres, the
API, Caddy and Docker, and nobody has run the stack on it yet
([hostinger.md](../deployment/hostinger.md), "prepared, not yet deployed"), so
free memory is **unknown**. The condition for approving R1:

1. **Build the routing files off the VPS** (a developer machine), using the
   `car` profile and the `MLD` algorithm, and copy only the built files up.
2. Run the container with a hard memory limit (Docker `mem_limit`) so a
   problem cannot take the API down.
3. Before go-live, measure on the real VPS: OSRM resident memory, and free
   memory after the whole stack is running. **Pass:** OSRM under 1.5 GiB and the
   API unaffected. **Fail:** do not deploy OSRM. Orders use delivery-zone rates
   (FR-022, which the SRS allows) until budget exists for R2.
4. Check route quality: compare OSRM with a handful of known Enugu routes
   (the OSM wiki lists an Enugu State routing project that digitised the road
   network, but I could not confirm its quality). Distances that look wrong are
   a reason to keep zone rates in force.

The data refresh is a manual monthly step in the first version (download,
build off-server, copy, restart); automating it is a later issue.

I did not run this measurement here: the machine I used has about 1 GB of free
memory and Docker was not running, so a number from it would mean nothing.

R3 is the best fallback if both R1 and R2 are unwanted, but it changes the
SRS wording and the adapter, so it is a proposal for the team, not a swap.
R4 is excluded.

## 6. Fallback when a provider is down

The rule: **a failed provider must never block an order and never produce a
made-up price.** Each case:

| What fails | What the customer sees | What happens to the price |
| --- | --- | --- |
| Map tiles do not load | A message that the map is unavailable, and the address form (already filled) remains usable | None. The pin is optional (FR-020) |
| Device location refused, unavailable or timed out | "Use my location" explains and offers the typed address and the map | None. The delivery area is chosen from the service zones |
| Typed address with no pin | Normal order | **Delivery-zone rates** (FR-010, FR-022) |
| OSRM down, slow, or no route | Normal order | **Delivery-zone rates**, or a **manual quote** if the zone has none (FR-022). Never straight-line distance. The quote snapshot records which rule was used (FR-024) |
| The pin is outside every active service zone | "Outside our delivery areas" from the real zones, with the request-assistance state (FR-010) | No instant quote |
| Browser offline | The existing offline state | None |

The backend decides the price in every case; the browser only sends the
optional coordinates (FR-022: "prices submitted by a customer's client are
never trusted"). The OSRM call needs a short timeout so a slow server is
treated as down; #340 and the pricing code choose the value.

## 7. Cost summary and budget

Monthly ceiling for maps and routing in the pilot: **$0** (the owner's
statement of 2 November 2026: no budget). The columns other than the first are
**not approved spend**; they show what each fallback would cost if a budget
appears.

| Scenario | Recommended (M1 + G1 + R1) | If R1 fails: M1 + G1 + R2 | If tiles fail: M2 + G1 + R1 | Everything hosted: M2 + G2 + R3 |
| --- | --- | --- | --- | --- |
| Low, 100 orders | $0 | $6.49 now, $11.99 at renewal | $20 | $20 |
| Medium, 1,000 | $0 | same | $20 (about 40,000 credits for tiles) | $20 |
| High, 10,000 | $0 | same | $20 (about 400,000 credits) | $20 (about 1.03M credits: 400,000 tiles + 600,000 routing + 30,000 searches, so under $1 of overage at 3¢ per 1,000) |

Two limits of this table: it uses the per-order assumptions in section 2, and
the $20 and $6.49 figures are list prices that can change; check them again
at purchase. Every column except the first is above the $0 ceiling.

## 8. Personal data and the privacy notice

**A location pin is personal data.** It points to where a person lives and
takes delivery, and it is stored with their name and phone. Nigerian
data-protection guidance lists location data as an identifier (secondary
summaries of the Nigeria Data Protection Act 2023; the Act's text should be
checked by whoever owns the notice). It is more precise than the typed
address, so treat it as an address: same access, same retention, same
deletion.

How each piece behaves:

| Item | Where it goes | Kept |
| --- | --- | --- |
| Device position (browser location) | Stays in the customer's browser until they confirm the pin. Never requested on page load or at sign-up (#345) | Only if the customer saves the address or places the order |
| Saved address pin | Our database, with the saved address (#340) | While the account is open; deleted when the account is closed; cleared by the privacy tool (#340) |
| Order's pin | The order keeps its own copy (FR-024) | 3 years after the order is completed, like the delivery address; then deleted or anonymized |
| Map tile requests | Browser to the tile provider: IP address and the tiles viewed, not the address text | Per the provider's own policy (to be read before approval) |
| Two coordinates to OSRM | Our own server (R1 or R2) | Not stored by OSRM; the distance goes into the quote snapshot |

**What the privacy notice needs to say** (`PRIVACY_NOTICE.md`; the website's
`/privacy` page mirrors it, so both change together). #340 owns the edit;
this is the content it needs:

1. **Section 2, new row:** "A map location (latitude and longitude) of your
   delivery address, only if you choose to share your device location or place
   a pin | Price the delivery by road distance and help the rider find you."
2. **Section 5, rewrite.** Replace "The app does not ask for your phone's
   location" with: the app asks for your phone's location **only when you
   choose "Use my location"**, after explaining why; you can refuse and type the
   address instead, and nothing is lost except the road-distance price (zone
   rates apply). The map location is used for the price and for delivery, kept
   with the address, and never used to track you. The driver GPS sentence stays.
3. **Section 7, recipients:** the map provider (named after approval) receives
   your IP address and the parts of the map your device downloads, not your
   address; and the driver sees the pin with the address, only on their
   assigned order and only while assigned (decided 2 November 2026: the rider
   needs the exact gate, and the pin is treated like the address). #340's
   contract must expose it to the driver endpoints only, and the driver app
   must open it from the order, not store it.
4. **Section 8, retention rows:** saved-address locations are kept while the
   account is open; an order's location follows the order's 3-year period.
5. **Section 15:** bump the version and date (the notice says it is updated
   before a change takes effect).
6. **`docs/process/privacy-retention.md`** gets the same two rows, and
   `anonymize-customer` must clear locations (both in #340's Done when).

## 9. What this approval commits the team to

If a reviewer approves the recommended options:

- **New frontend dependency:** `maplibre-gl` (BSD-3-Clause), added by #345
  and #346, loaded lazily.
- **New external service:** OpenFreeMap public tiles (no key, no cost).
- **New infrastructure:** one OSRM container with its data volume (no new
  server), plus a monthly manual data refresh. Written up in
  [hostinger.md](../deployment/hostinger.md) by the issue that adds it.
- **No geocoding provider** and no backend geocoding adapter in #340.
- **Not committed:** any paid plan. There is no budget; a paid fallback needs a new budget decision.

What changes in the follow-up issues once approved (I will post these as
comments on each issue, with the reviewer's OK):

| Issue | Change |
| --- | --- |
| #340 | No geocoding adapter is needed (G1). OSRM runs as in R1, if it passes the measurement. The privacy edits are in section 8 |
| #345 | MapLibre with OpenFreeMap tiles. Its "searching" state is the wait for device position or map load, not text suggestions. Offline, denied and unavailable states follow section 6 |
| #346 | MapLibre with OpenFreeMap tiles, lazily loaded |

## 10. Approval

```text
Design reviewer (not the author):   cloudcrackamara
Date:                               2026-11-02
Approved options:                   Map and tiles: M1  Address search: G1  OSRM: R1
Conditions or changes:              1. OSRM (R1) is deployed only if, measured on the
                                       real VPS before go-live, OSRM uses under 1.5 GiB
                                       and the API is unaffected. If it fails, OSRM is not
                                       deployed and orders use delivery-zone rates
                                       (section 5). Route quality is also checked against
                                       known Enugu routes.
                                    2. Routing files are built off the VPS, with a hard
                                       container memory limit (section 5).
                                    3. A person reads OpenFreeMap's privacy policy before
                                       go-live. If its logging is unacceptable, switch the
                                       tile address to M2, which needs a new budget decision
                                       (section 3).
                                    4. No paid plan is approved (section 9). A paid fallback
                                       needs a new budget decision.

Budget holder:                      nnamdi-security
Monthly ceiling agreed:             $0  (https://github.com/mmiri-oma/mmirioma/issues/334#issuecomment-6589912380)
```

Both blocks are filled in. The conditions above still apply when the map work
is built and deployed.

## 11. Sources and open questions

Checked on 2 November 2026. Prices change; confirm before paying.

| Fact | Source |
| --- | --- |
| Stadia plans, credits, commercial use | https://stadiamaps.com/pricing/ |
| MapTiler plans, free plan limits | https://www.maptiler.com/cloud/pricing/ (a search summary listed Flex at $25; the page I fetched says $30) |
| OpenFreeMap terms | https://openfreemap.org |
| OpenStreetMap tile rules | https://operations.osmfoundation.org/policies/tiles/ |
| Nominatim rules | https://operations.osmfoundation.org/policies/nominatim/ |
| OSRM demo server rules | https://github.com/Project-OSRM/osrm-backend/wiki/Api-usage-policy |
| OSRM disk and memory | https://github.com/Project-OSRM/osrm-backend/wiki/Disk-and-Memory-Requirements |
| Nigeria extract size | https://download.geofabrik.de/africa/nigeria.html |
| MapLibre licence | https://github.com/maplibre/maplibre-gl-js |
| Hostinger KVM 1 price | https://www.hostinger.com/vps-hosting (as seen through a search summary, not the live page) |

**Not verified, and who should check:**

- OpenFreeMap's privacy policy and what it logs (reviewer, before approval).
- Stadia's attribution rules and rules on storing geocoding results (only
  matters if M2 or G2 is chosen).
- The exact wording of the Nigeria Data Protection Act 2023 on location data
  and on sending data to a processor abroad (the owner of the privacy notice).
- OSRM memory on the real VPS and route quality in Enugu (the gate in section 5).
- Coverage of any geocoder with its own Nigerian address data (not tested).

**Open questions for the team:**

1. Who is the budget holder? The owner has said the ceiling is $0; that still
   needs to be recorded as a comment on #334.

**Answered on 2 November 2026 by the owner:**

- A $10 monthly ceiling is not acceptable: no budget, so the most
  cost-effective option (all $0 here).
- "No text search" (G1) is acceptable for #345's design.
- The driver sees the pin on their assigned order (section 8, item 3).
