# External routing provider research for #408

**Status: proposal, not approved.** @nnamdi-security + Codex, 12 November
2026. No account, credential, paid plan, live route request or new dependency.
The existing [maps decision](maps.md) stays in force until agreement.

**Owner response, 12 November 2026:** "Propose Geoapify; keep spending at $0."
This authorizes this proposal only. Reviewer approval of terms, attribution,
privacy and quota limits remains required; no account, paid plan or live
routing is enabled.

## Recommendation and alternatives

Propose Geoapify Free through a provider-neutral backend adapter. Keep the
$0 spending ceiling, OpenFreeMap/MapLibre and manual address/pin entry. No
hosted geocoder is proposed. The new provider replaces self-hosted OSRM only
after approval, tests and #413's retirement work; it is disabled by default.

| Option | Assessment |
| --- | --- |
| Geoapify Free | Candidate: commercial use, matrix distance/time and stored-result support on public pages; quota, privacy and terms checks below remain gates |
| Zone fees/manual quote only | Working $0 fallback; no road-ranked source selection or route-derived ETA |
| Existing self-hosted OSRM | Existing code, but #408 explicitly excludes self-hosting; do not enable it as a workaround |
| Another hosted provider | Not selected/researched in depth; needs its own terms, pricing, response-quality and privacy review |

## Verified public-source findings

Checked official pages on 12 November 2026; these are provider statements,
not legal advice, measured service quality or guarantees.

- [Pricing](https://www.geoapify.com/pricing/): Free is 3,000 credits/day,
  up to five requests/second, with commercial production use subject to limits
  and attribution. Limits are soft, so do not rely on automatic free-tier
  cutoffs. No card is needed to register; no paid upgrade is authorized.
- [Matrix documentation](https://apidocs.geoapify.com/docs/route-matrix/):
  directed distance/time, original and matched points, null unroutable cells;
  metric requests use metres/seconds. Normal calls allow 1,000 cells.
  Baseline credits are `max(S,T) × min(S,T,10)`, with possible distance/option
  surcharges. For N sources to one destination the baseline is N, not one.
- [Routing product page](https://www.geoapify.com/routing-api/): says routing
  results may be stored and redistributed. The inspected terms do not
  explicitly describe matrix-result retention; reviewer must confirm this
  permission covers immutable quote snapshots and the required retention.
- [Terms](https://www.geoapify.com/terms-and-conditions/): identify KEPTAGO LTD
  in Cyprus, require OpenStreetMap and Free-plan Geoapify attribution, and
  reserve suspension/overage remedies. They qualify free production use;
  reviewer must reconcile this with the pricing FAQ before activation.
- [Privacy](https://www.geoapify.com/privacy-policy/): API logs include body,
  headers, IP and time; successful requests are generally retained no longer
  than 24 hours. It describes EU hosting and Cloudflare/Hetzner, with Bunny
  CDN for .eu calls. Failed-request retention is not bounded explicitly by
  that statement. Coordinates in the request body therefore leave our system
  and can be logged; do not describe them as unrecorded.

## Budget protection proposal

No paid subscription, card, overage consent or split-account quota evasion.
Reviewer must confirm the account cannot incur charges without a separate
approval. Public soft limits alone are insufficient for the $0 constraint.

Propose an application cap of **2,000 conservatively reserved credits/day**,
shared by quotes and dispatch, plus at most **four provider requests/second**
and **20 candidate cells per quote**. These are reviewable engineering limits,
not product volume promises or provider guarantees. Reserve before sending,
using persistent atomic database counters; count attempts conservatively,
including ambiguous failures, across processes and restarts. Reserve possible
surcharges or refuse the call; reset boundaries must match the provider's
confirmed billing day. No confirmed boundary means no activation. A limit
reached sends quotes to zone/manual fallback and never creates paid traffic.
The cap must include other requests using the account and #411 ranking; an
untracked shared key cannot support a hard spending promise.

Illustration only: ten sources × three quotes per order = 30 baseline
credits/order. The proposed 2,000-credit cap allows at most 66 such orders/day
before dispatch, surcharges or other requests. This is capacity arithmetic,
not a demand forecast. Re-measure with real candidate counts and call patterns.

## Attribution and data handling

Keep the API key server-side as SecretStr; request/query logging must not
expose it. Send only coordinate arrays and travel mode, without customer or
order identifiers. Store derived snapshot numbers, not raw payloads/matched
coordinates. Provider logging still applies even with this minimization.

Propose visible Geoapify/OpenStreetMap attribution beside route-derived quote
information, plus the receipt where required. It needs #409 G2; browser map
attribution alone may not cover a price shown without a map. Reviewer checks
the provider's exact attribution wording/placement before agreement.

Coordinate cross-border disclosure, retention and processor obligations with
#392. This research does not decide legal compliance or modify the public
privacy notice. Current quote-pin retention/anonymization continues.

## Activation checklist

- [ ] Reviewer approves provider, matrix storage rights, attribution and $0 terms.
- [ ] Privacy reviewer approves coordinate transfer and provider logging.
- [ ] Confirm quota reset day, account sharing and conservative surcharge budget.
- [ ] Validate loaded Keke/tanker modes and known Enugu routes/pins; no live
      customer coordinates in tests or demonstration requests.
- [ ] Agree match-quality threshold, budget limits and fallback semantics.
- [ ] #407 built; #408 G3 and #409 G2 recorded; no surprise paid traffic.

Related proposal: [road-pricing-and-eta.md](../api/road-pricing-and-eta.md).
