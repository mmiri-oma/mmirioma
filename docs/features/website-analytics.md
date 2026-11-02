# Website analytics and cookie consent

Status: built on `feat/waterline-redesign` (2026-11-02). Not deployed.

## 1. Overview and purpose

The team wants to know how people use the public website and roughly where
they come from (city or country), to improve the pages that lead to an
order. The public pages use **Google Analytics 4 (GA4)** for this, and only
after the visitor agrees in a cookie banner. The signed-in apps are never
measured.

## 2. Feature workflow

1. A visitor opens a public page (`/`, `/faq`, `/terms`, `/privacy`). If a
   GA4 measurement ID is configured and they have not chosen yet, a banner
   asks: "Accept analytics", "Reject" (the same size, so neither is the easy
   choice) or "Choose what to allow" (Necessary always on; Analytics off
   until switched on).
2. The choice is saved in this browser (`localStorage`, key
   `waterline.consent.v1`) with the time it was made, and the banner goes.
3. **Accept:** `gtag.js` loads with Google Consent Mode v2 (everything
   denied by default, then only `analytics_storage` granted), and the current
   page is counted. **Reject:** nothing loads; if analytics had been on, it is
   switched off and the `_ga` cookies are deleted.
4. Each public page sends a `page_view` (from `useMarketingPage`). Buttons
   send events: `order_cta_click` (with where: header, hero, size picker,
   dock, closing), `driver_cta_click`, `size_picker_mode`, `area_check`
   (only whether the area matched, never the text typed).
5. "Cookie settings" in the footer reopens the banner on the detail view with
   the saved choice.

## 3. Important files

| Path | Responsibility |
| --- | --- |
| `frontend/src/lib/analytics.ts` | Consent storage and store, GA4 loading with Consent Mode, `track()`, cookie removal on Reject |
| `frontend/src/features/marketing/CookieConsent.tsx` | The banner and its detail view |
| `frontend/src/features/marketing/MarketingParts.tsx` | Renders the banner in the footer, so every public page asks the same way; "Cookie settings" button |
| `frontend/src/features/marketing/useMarketingPage.ts` | One `page_view` per public page |
| `frontend/.env.example` | `VITE_GA_MEASUREMENT_ID` |
| `PRIVACY_NOTICE.md`, `LegalPages.tsx` | Section 7 (Google as a recipient) and section 13 (cookies), version 3.1 |

## 4. Database models and relationships

None. Nothing is stored on our server; the choice lives in the visitor's
browser and the analytics data in Google Analytics.

## 5. API endpoints and request/response behavior

None of ours. After consent the browser loads
`https://www.googletagmanager.com/gtag/js?id=<ID>` and sends events to
Google's collection endpoints.

## 6. Important business rules

- Analytics is off until the visitor accepts it (consent for non-essential
  cookies, Nigeria Data Protection Act 2023; SRS NFR-005).
- Public pages only. The banner and the page views live in the public pages'
  components, so the customer, driver and staff apps are never measured.
- No personal data in events: no names, phone numbers, addresses or typed
  text. GA4 itself does not store IP addresses; location is approximate.
- No advertising: `ad_storage`, `ad_user_data` and `ad_personalization` stay
  denied.
- The necessary sign-in cookie is not affected by the choice.

## 7. Authentication and authorization

None; public pages.

## 8. Error handling and edge cases

- No `VITE_GA_MEASUREMENT_ID`: no banner, no "Cookie settings", nothing loads.
- Storage blocked (private browsing): the choice applies to this visit only;
  the banner asks again next time.
- A damaged saved value is ignored (treated as "not chosen").
- Reduced motion: the banner appears without animation.

## 9. Testing instructions

```bash
cd frontend
npx vitest run src/lib/analytics.test.ts src/features/marketing/CookieConsent.test.tsx
```

Covers: nothing loads before consent; Accept loads `gtag.js` once with only
analytics granted; no ID means nothing loads; events only while allowed;
Reject denies storage and deletes `_ga` cookies; the banner's Accept, Reject,
detail view and reopening from "Cookie settings". Manual: with an ID in
`frontend/.env.local`, open `/`, accept, and check GA4 DebugView.

## 10. Known limitations

- Adding GA4 is a new external service: it needs the team's approval
  (`CLAUDE.md`, approved stack) and a real measurement ID from the team's
  Google account before deploy.
- The privacy notice wording (version 3.1) should be reviewed by the legal
  operator before it goes live, together with the NDPA transfer assessment
  for Google (United States).
- The consent choice does not expire; to ask everyone again, change
  `CONSENT_KEY`.
