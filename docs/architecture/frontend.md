# Frontend architecture

How the React app is styled and how it calls the backend. All API calls go through
`src/lib/api/client.ts`; components must not call `fetch` directly.

Versions this document was written against: React 19.2, TypeScript 6.0,
Vite 8.3, Vitest 5.0.

## Files

| File                              | Responsibility                                         |
| --------------------------------- | ------------------------------------------------------ |
| `src/lib/api/client.ts`           | `createApiClient`, the shared `apiClient`, `ApiError`  |
| `src/lib/api/health.ts`           | Typed `getHealth()` for `GET /api/v1/health`           |
| `src/lib/api/auth.ts`             | `register`, `login`, `getMe`, `logout`; stores the CSRF token |
| `src/vite-env.d.ts`               | Types for `import.meta.env.VITE_API_BASE_URL`          |
| `src/lib/api/client.test.ts`      | Vitest tests with a mocked `fetch`                     |
| `src/lib/format/money.ts`         | `formatNaira` (integer kobo → `₦6,500`), `nairaInputToKobo` |
| `src/lib/format/datetime.ts`      | Africa/Lagos date and time display in the design's formats |

New endpoints follow the `health.ts` pattern: one small typed function per
endpoint, grouped in a file per backend module.

## Configuration

`VITE_API_BASE_URL` sets the API origin (e.g. `http://localhost:8000`), normally
in `frontend/.env.local` (see `frontend/.env.example`). Vite embeds it at build
time, so it is public: never put secrets in `VITE_*` variables.

If it is unset:

- in `npm run dev`, the client falls back to `http://localhost:8000`;
- in a production build, every request fails with an `ApiError` of kind `config`
  and code `missing_api_base_url`. There is no silent default.

## Request behavior

- `credentials: 'include'` on every request, so the HttpOnly session cookie is
  sent. The backend allows this only for the exact `FRONTEND_URL` origin.
- **CSRF:** `client.setCsrfToken(token)` stores the token from the last session
  response in memory. Every non-GET request then sends it as `X-CSRF-Token`.
  The `auth.ts` functions call it for you: `login`, `register` and `getMe` set
  it, and `logout` clears it. Call `getMe()` on page load, because a reload
  loses the in-memory token. It is never written to `localStorage`, so a script
  injected through XSS cannot read it from storage later.
- `Accept: application/json` is always sent. `body` is JSON-encoded and sets
  `Content-Type: application/json`.
- A successful response is parsed as JSON and returned as `T`. The type is **not**
  validated at runtime; validate with Zod at the call site if the data drives
  important logic.
- An empty body returns `null`.

## Errors

Apart from cancellation, every failure is thrown as `ApiError`:

| `kind`    | When                                         | `status`  | `code`                                  |
| --------- | -------------------------------------------- | --------- | --------------------------------------- |
| `network` | `fetch` rejected (offline, DNS, CORS, down)  | `null`    | `network_error`                         |
| `http`    | non-2xx with the backend error envelope      | HTTP code | backend `error.code`                    |
| `http`    | non-2xx with a JSON body that is not the envelope | HTTP code | `http_error` (body in `details`)   |
| `parse`   | body is not valid JSON                       | HTTP code | `invalid_response` (2xx) / `http_error` |
| `config`  | base URL missing in a production build       | `null`    | `missing_api_base_url`                  |

- Branch on `code`, not `message`.
- Aborted requests (via `signal`) rethrow the original `AbortError` so callers can
  ignore it instead of showing an error.
- Backend 500 errors currently arrive as `network` errors in the browser, because
  the backend does not add CORS headers to them (see
  [backend.md](backend.md#error-handling-appcoreerrorspy)).

## Styling and design system (fork: new design)

This fork builds the UI from the design handoff in
`design/MmiriOma-design-handoff/` (kept locally, git-ignored). The decisions
and the screen list are in [docs/design/handoff-v1.md](../design/handoff-v1.md).
It replaces the main repo's design system for this fork only.

Tailwind CSS v4 is enabled the way its official Vite guide describes: the
`@tailwindcss/vite` plugin in `vite.config.ts` and `@import "tailwindcss";` in
`src/index.css`. There is no `tailwind.config.js`. `src/index.css` only imports:

| File | Holds |
| --- | --- |
| `src/styles/theme.css` | `@theme static` tokens: every colour, type size, radius, shadow and spacing from `tokens/mo.css` and `tokens.json`. Tailwind's default palette is removed (`--color-*: initial`), so only exact design colours exist (`bg-primary`, `text-mute`, `shadow-card`, `rounded-card`...). `static` emits every variable, so inline styles and SVG can use `var(--color-*)` |
| `src/styles/fonts.css` | Offline copy of Plus Jakarta Sans (see below) |
| `src/styles/motion.css` | Design keyframes and utilities: `rise-1`..`rise-5`, `animate-float`, `animate-drive`, `animate-ping`, `route-flow`, `animate-pop`, `animate-wave`, `animate-sway`, `confetti-piece`, `glow`, `blink`, `shine`, `animate-slide-in`, `animate-sheet`, `animate-shake`, `animate-grow-x/y`, `animate-donut` |
| `src/styles/base.css` | Body defaults, link colours, visible focus ring, `hit-44` touch-target helper |
| `src/styles/components.css` | Default looks of shared components (`mo-card`, `mo-btn-*`, `mo-chip-*`, `mo-scroll`...) ported from `mo.css`, in `@layer components` |

Where `mo.css` and `tokens.json` disagree, `mo.css` wins, because the design
PNGs were rendered from it (gold is `#F2B33D`, not `#E6BA54`).

### Font

Plus Jakarta Sans (400 to 800) loads from Google Fonts (`index.html`). The font
stack is `'Plus Jakarta Sans', 'Plus Jakarta Sans Offline', system-ui,
sans-serif`. If Google Fonts cannot be reached, the browser uses the second
family, served from `public/fonts/` (OFL licence in `public/fonts/OFL.txt`).
When Google Fonts loads, the offline files are never downloaded. The offline
copy has the latin, latin-ext (naira sign ₦) and vietnamese (Igbo ọ ụ ị)
subsets.

### Motion

Only transform and opacity are animated. The design's `glow` (box-shadow),
`blink` (border-color) and `shine` (background-position) were reworked to the
same look on a pseudo-element using transform/opacity. Two SVG stroke
animations stay as designed because a dashed or partial stroke has no
transform equivalent: `route-flow` and `animate-donut`. Under
`prefers-reduced-motion: reduce` every animation stops and confetti is hidden.

Loading (2026-10-21, not in the handoff): `skeleton` (placeholder with a light
sweep, used by `LoadingBlock`), `WaterLoader` (bobbing drop with a ripple, the
full-screen `LoadingScreen`), and `RouteProgress` (`src/app/RouteProgress.tsx`,
a 3 px bar along the top while the next page's chunk loads, shown only after
150 ms so quick changes do not flash it). All transform/opacity only.

Hover states live in `styles/components.css` inside `@media (hover: hover)`,
so a tap on a phone never leaves a button looking hovered. A screen that
overrides a component colour with a utility must add its own `hover:`
utility, because utilities always beat the components layer. Button labels
are centred (`justify-content` and `text-align`). Filter pills (`.mo-pill`)
are 10 px rounded rectangles, not pills (owner request).

### Assets and icons

- `public/brand/`: official logos (use `<Logo>` from `src/components/brand/Logo.tsx`,
  WebP with PNG fallback, right density per screen). Never redraw the logo.
- `public/illustrations/`: keke, tanker, gift, jerrycan, drop-hero (use
  `<Illustration>`). `jerrycan` and `drop-hero` exist only as WebP.
- `public/favicon.ico`, `favicon-16.png`, `favicon-32.png`, `apple-touch-icon.png`,
  `public/icons/icon-{192,512,1024}.png` and `public/manifest.webmanifest`.
- `src/components/icons/`: the 74 inline stroke icons from the design HTML,
  with exact paths. `Icon` takes `size`, `strokeWidth`, `filled`, `roundJoin` and
  an optional `label` (otherwise `aria-hidden`).

## App structure

| Path | Holds |
| --- | --- |
| `src/App.tsx` | `AppProviders` around `RouterProvider` |
| `src/app/providers.tsx`, `queryClient.ts` | TanStack Query client: queries retry network and 5xx errors up to twice, never 4xx or config errors; mutations never retry (an order retry must reuse its idempotency key, FR-026) |
| `src/app/router.tsx` | Route table (`createBrowserRouter`). Every route sits under `AppRoot` (manifest switch, offline notice). Public pages `/`, `/faq`, `/terms`, `/privacy` (features/marketing), `/app` (where the installed customer app opens: home or sign-in), customer routes, partner routes under `/partner/`; `NotFound` catches everything else |
| `src/lib/api/mode.ts` | `USE_MOCKS`: `VITE_USE_MOCKS=true/false`, or unset = mocks in dev, real API in production builds. Typed API functions check it, so screens never know whether data is mocked |
| `src/dev/` | Development-only pages (component gallery at `/dev/mobile`, `/dev/menu`, `/dev/admin`, foundations at `/dev/foundation`). Registered only when `import.meta.env.DEV`, so they are not in production routes |

## Why component defaults are in a CSS layer

Tailwind v4 orders utilities by value, not by the order of classes on an
element: with `gap-3.5 gap-3` on one element, `gap-3.5` wins; `px-2.5` beats
`px-2`; `flex-row` beats `flex-col`. So a component whose defaults were
utilities could not be reliably overridden by a screen. Component defaults
therefore live in `@layer components` (`src/styles/components.css`), which
always loses to utilities. Rule: a component may add utilities only for
states it owns (selected, disabled); anything a screen may change goes in the
components layer. Never put two utilities for the same property on one
element.

## Data, mocks and API functions

- `src/domain/`: shared types (orders, quotes, addresses...). JSON field names
  follow the API conventions.
- `src/features/<app>/<app>Api.ts`: one typed function per operation. Each
  returns mock data when `USE_MOCKS` is on and otherwise calls the API through
  `client.ts`, or rejects with `ApiError` code `not_connected` while the
  endpoint does not exist (`src/lib/api/notConnected.ts`).
- `src/features/<app>/queries.ts`: TanStack Query hooks; screens use only these.
- `src/mocks/`: the mock backend. `db.ts` holds one state object saved in
  localStorage (survives closing the tab or the installed app, like the real
  7-day session; other tabs pick up changes through the `storage` event); `seed.ts` has the design's
  sample people and orders and the mock-only demo sign-in (every mock account
  uses `DEMO_PASSWORD`; `TEST_CUSTOMER_PHONE`, "Test Customer", is a
  customer whose phone is already verified, with no addresses or orders, for
  testing a first order without the SMS code step); `pricing.ts`
  computes sample quotes so screens never add up prices. Mock handlers
  enforce the same rules as the server: session, ownership 404s,
  idempotency, validation errors in the API envelope.
- Forms: React Hook Form + Zod. Shared fields and the server-error mapper are
  in `src/lib/forms.ts`. Phone numbers: `src/lib/format/phone.ts`.
- Sessions: `src/features/auth/useSession.ts` (`GET /auth/me` once per page
  load, 401 = signed out), `RequireRole` for protected routes. Sign-out clears
  the whole query cache.

## Shared components

All built from the design handoff's `mo.css` classes and the screens' inline
styles, with the exact values. Each exported component has TSDoc.

| File | Components (design class) |
| --- | --- |
| `components/ui/Button.tsx`, `buttonClasses.ts` | `Button`, `ButtonLink` (`.btn`, `.btn.alt`, `.btn.line`, `.btn.sm`); disabled (`#C9D6E6`) and loading (`aria-busy`, label kept) states |
| `components/ui/IconButton.tsx` | `IconButton`, `IconLink` (`.ib`, `.ib.soft`, unread `.dot`) |
| `components/ui/Avatar.tsx` | `Avatar` (`.av`, initials; `brand`, `green` for the tanker app, `plain`) |
| `components/ui/Card.tsx` | `Card`, `CardLink`, `CARD` (`.card`, `.pad`) |
| `components/ui/Chip.tsx` | `Chip` (`.chip` tones), `SampleTag` (`.sample`) |
| `components/ui/Choice.tsx` | `OptionTile` (`.opt`, `.tick`, `.ring`), `RadioDot` (`.radio`), `RadioRow` |
| `components/ui/Field.tsx` | `TextField`, `TextAreaField` (`.lbl`, `.in`), with hint, error (`role="alert"`, `aria-describedby`) and "(optional)"; `type="password"` adds a Show/Hide password button |
| `components/ui/ConfirmDialog.tsx` | `ConfirmDialog`: asks before log out, payments, rider approval changes, removing an address, deleting the account, resetting data. Portal on `<body>`, focus starts on Cancel and stays inside, Escape and the backdrop cancel, focus returns to the opener |
| `components/ui/Controls.tsx` | `Segmented` (`.seg`), `PageTabs` (sign-in switch), `Pills` (`.pill`), `Toggle` (switch; knob moves with transform) |
| `components/ui/Content.tsx` | `ScreenHeading`, `SectionTitle`, `SectionHeader`, `GroupLabel`, `TextLink`, `KeyValue` (`.kv`), `Separator` (`.sep`), `IconBadge` (`.ico`), `ActionTile` (`.tile`), `MenuItem` (`.mi`), `StepBar`, `CountBadge` |
| `components/ui/CodeEntry.tsx` | `CodeBoxes` (`.otp`, blink, invalid shake), `Keypad` (also takes the physical keyboard) |
| `components/ui/Admin.tsx` | `StatCard` (`.stat`), `DataTable` (`.tbl`), `MiniButton`, `MiniLink` (`.mini`) |

Controls drawn under 44 px (pills, mini buttons, small buttons, segments,
switches) use `hit-44` for an invisible 44 × 44 touch area.

## Layout shells

- `components/layout/MobileShell.tsx`: `MobileShell` (`.ph`), `TopBar` (`.top`)
  with `BackLink`, `MenuLink`, `NotificationsLink`, `ProfileLink`,
  `TopBarTitle`, `TopBarSpacer`; `ScrollArea` (`.scroll`) and `Footer`
  (`.foot`). The shell is `100dvh` tall with one scrolling area; from 360 px it
  fills the screen, on tablets and desktops it is a centred column at most
  430 px wide. Footer and tab bar pad above the phone's home bar
  (`env(safe-area-inset-bottom)`).
- **Customer app on desktop** (Waterline redesign): from 1024 px,
  `CustomerArea` wraps every customer screen in `.customer-app` and renders
  `CustomerDesktopHeader` (logo, Home, Order water, My orders, Addresses,
  Profile, notifications, avatar; only on wide screens, through
  `lib/useMediaQuery.ts`, so phones and tests have one navigation). Unlayered
  rules at the end of `styles/components.css` turn the phone frame into a
  page there: the screen's own top bar becomes a slim row (logo hidden), the
  phone top bar of home screens (`.mo-top-home`) and the bottom tabs
  (`.mo-tabs`) are hidden, the page scrolls normally, content sits in a
  760 px column (`.app-wide` screens such as home: 1,120 px, two columns), and
  the footer button stays at the bottom of the window. The driver app keeps
  the phone frame.
- `components/brand/FlatArt.tsx`: the Waterline flat keke, tanker and
  jerrycan; `Illustration` draws these names with them instead of the
  handoff's photo-style WebP files.
- `components/layout/BottomTabBar.tsx`: `.tabs`, current tab `aria-current`.
- `components/layout/DrawerMenu.tsx`: slide-in menu screens (`c-menu`, `r-menu`,
  `t-menu`); closes on backdrop, close button or Escape. `tone="green"` gives
  the tanker app's green backdrop, header and current row (`MenuItem tone`).
- `components/layout/AdminShell.tsx` and `adminNav.tsx`: header (logo, search,
  notifications, profile), the full 13-item sidebar from the dashboard design
  on every admin page, count badges. From 1024 px the 248 px sidebar is on the
  left; below that a menu button opens it as a drawer (decision 25: responsive
  on all devices; a 13-row list above the content would push it off screen).

## Testing

```bash
cd frontend
npm test          # Vitest; node environment by default
```

Component tests (`*.test.tsx`) start with `// @vitest-environment jsdom` and use
Testing Library (`@testing-library/react`, `user-event`, `jest-dom` matchers;
setup in `src/test/setup.ts`). They cover the keypad (buttons and physical
keys, six-digit limit), toggle, option tile, pills, button loading, text field
errors, icon link positioning, admin navigation and the admin menu drawer.

Tests create a client with `createApiClient({ baseUrl, fetch: mockFetch })`; no
server is needed. They cover the health call (URL, method, credentials), JSON
bodies, envelope mapping, non-envelope errors, network errors, aborts, a
missing base URL, and (`auth.test.ts`) storing, sending and clearing the CSRF
token.
`src/lib/format/format.test.ts` covers naira display from integer kobo
(whole amounts, kobo kept, minus sign, non-integer rejected), staff naira
input, and Africa/Lagos formatting including the UTC day rollover.

## Installable apps (PWA) and push

Two installable apps share one origin and one service worker
(details: [docs/features/pwa.md](../features/pwa.md)):

- **Manifests.** `public/manifest.webmanifest` (customer, scope `/`, start
  `/app`) and `public/partner.webmanifest` (scope `/partner/`, start
  `/partner/`). Every page is the same `index.html`, so
  `src/features/pwa/manifest.ts` points the `<link rel="manifest">` at the
  right app by path, at start-up (`main.tsx`) and on every navigation
  (`AppRoot`). All partner routes therefore live under `/partner/`.
- **Service worker.** Written by hand in `src-sw/sw.ts` (own
  `tsconfig.sw.json` with WebWorker types; ESLint uses service-worker
  globals there). `vite-plugin-pwa` in `injectManifest` mode builds it and
  fills in the file list (`vite.config.ts` globs). Navigation is network
  first with the saved `index.html` as fallback; built files are cache first;
  Google Fonts are stale-while-revalidate; API calls are never touched.
  Registered from `src/features/pwa/registerServiceWorker.ts`; in dev the
  plugin serves `/dev-sw.js?dev-sw`.
- **Install state.** `installPrompt.ts` is imported first in `main.tsx`
  because `beforeinstallprompt` can fire before React renders. Components read
  it through `useInstallAction()`.
- **Push.** `push.ts` asks permission only on a tap, subscribes with
  `VITE_VAPID_PUBLIC_KEY` in real mode, and saves through `pushApi.ts`
  (mock or `not_connected`). Mock delivery: `src/mocks/db.ts` calls
  `mockPush.ts` after every change, which shows new notifications for users
  who turned push on in this browser.

## Code splitting

Every customer, partner and admin page is a React Router `lazy` route
(`routes.tsx` in each feature): its code is a separate chunk loaded the first
time the page opens. The main bundle keeps the router, guards
(`CustomerArea`, `PartnerArea`, `AdminArea`), shared components, the mocks and
the public pages, so the landing link opens without waiting for app code.
The root route's `hydrateFallbackElement` shows the loading screen while the
first chunk arrives; the service worker precaches all chunks, so pages still
open offline. Its `errorElement` (`src/app/RouteError.tsx`) catches any route
error: a chunk missing after a new deploy (an open tab asking for an old
hashed file) reloads the page once, at most once a minute; anything else
shows the app's error screen. Sizes after splitting: main bundle about 385 kB (113 kB
gzipped), page chunks 1 to 15 kB. The public pages use no form, so React
Hook Form and Zod stay out of the main bundle; the public mock
(`mocks/publicMock.ts`) is a dynamic import for the same reason.

## Admin

**Responsive admin.** Staff mostly use desktops, sometimes tablets and
phones. `DataTable` renders a table from 768 px and a card per row below it
(first column as the card title); `SplitLayout` puts the detail panel beside
the list from 1024 px and under it below, and `revealDetail()` scrolls to it
after a pick on small screens. The staff sign-in is a split layout on
laptops and desktops and stacks on smaller screens.


`src/features/admin/` (details: [docs/features/admin.md](../features/admin.md)).
Routes use React Router's `lazy`, so every admin page is its own chunk and
phones using the customer or partner app never download admin code. Every
page renders `AdminFrame` (the Phase 1 `AdminShell` with live badge counts).
Admin mutations go through `useAdminMutation`, which refreshes all `admin`,
`partner` and `customer` queries, because one action (an assignment) changes
several screens. The mock admin server works on the same mock database as
the other apps; shared rules live in `src/mocks/adminState.ts` (current price
list, FR-012 station choice, audit and activity) and `src/mocks/pricing.ts`
(quotes from a versioned price list, delivery fee methods).

## Public pages

`src/features/marketing/` (details: [docs/features/public-pages.md](../features/public-pages.md)).
They use their own fonts (Outfit, DM Sans: loaded by `useMarketingPage`,
offline copies in `styles/fonts.css`) and `mk-*` colour tokens in
`theme.css`. Responsive background and grid switches at the design's
breakpoints are in `features/marketing/marketing.css` (imported by
`index.css`, `@layer components`); a class there that sets `display` must not
also get a `flex`/`block` utility on the element, or the utility wins and the
media query cannot hide it. Tailwind's `max-[N]` variants mean `width < N`,
so the design's `max-width: 960px` is written `max-[960.98px]`.

