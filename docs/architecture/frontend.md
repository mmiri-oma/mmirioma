# Frontend architecture

How the React app is put together and how it calls the backend. All API calls
go through `src/lib/api/client.ts`; components must not call `fetch` directly.

## App structure

One React app serves every area (CLAUDE.md, "Architecture"):

| Path | Area | Guard |
| --- | --- | --- |
| `/`, `/sign-in`, `/create-account` | Customer app | `AppGate app="customer"` (role `customer`) |
| `/staff`, `/staff/sign-in` | Staff (dispatcher) app | `AppGate app="staff"` (role `admin`) |

The driver app joins with S1-15. `src/main.tsx` mounts, outermost first:
`QueryClientProvider` (TanStack Query, `src/lib/queryClient.ts`),
`BrowserRouter` (React Router), `SessionProvider` (the current session from
`GET /auth/me`), then `AppRoutes` (`src/App.tsx`). Session handling, guards
and the auth screens are described in
[docs/features/authentication.md](../features/authentication.md).

- **Data fetching:** TanStack Query is now configured. New server data should
  use `useQuery`/`useMutation` with typed functions from `src/lib/api/`.
  Queries and mutations are not retried automatically; screens show the error
  with a Retry button. Any 401 `not_authenticated` re-checks the session, so a
  session that ended shows "Your session has ended" on its own.
- **Forms:** React Hook Form with Zod schemas (`@hookform/resolvers/zod`).
- **Features** live in `src/features/<feature>/`; shared design-system
  components in `src/components/ui/`.

Versions this document was written against: React 19.2, TypeScript 6.0,
Vite 8.3, Vitest 5.0.

## Files

| File                              | Responsibility                                         |
| --------------------------------- | ------------------------------------------------------ |
| `src/lib/api/client.ts`           | `createApiClient`, the shared `apiClient`, `ApiError`  |
| `src/lib/api/health.ts`           | Typed `getHealth()` for `GET /api/v1/health`           |
| `src/lib/api/auth.ts`             | `register`, `login`, `getMe`, `logout`; stores the CSRF token |
| `src/components/ApiStatus.tsx`    | Example component showing API reachability (no longer rendered) |
| `src/lib/queryClient.ts`          | TanStack Query client and the global 401 handling      |
| `src/vite-env.d.ts`               | Types for `import.meta.env.VITE_API_BASE_URL`          |
| `src/lib/api/client.test.ts`      | Vitest tests with a mocked `fetch`                     |

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

## Example component (not rendered)

`ApiStatus` is no longer on any page since the starter page was replaced
(S1-17); it stays as a reference. It calls `getHealth` once on mount and shows loading, success, or the
`ApiError` message. It aborts the request on unmount. In development, React
StrictMode mounts components twice, so the first request is aborted and its
result ignored. It uses `useEffect` because the app has no data-fetching layer
configured yet; when TanStack Query is set up, data fetching should move there.

## Styling (Tailwind CSS v4)

Design tokens from the approved design system
([docs/design/design-system.md](../design/design-system.md)) are the
`@theme` block in `src/index.css`, so utilities such as `bg-primary`,
`text-text-secondary`, `rounded-box`, `text-h1` and the `tablet:` / `desktop:`
variants exist. They extend Tailwind's defaults rather than replace them.
Checked against the build output: `--text-*--line-height` and
`--text-*--font-weight` apply with the `text-*` utility, and
`--breakpoint-tablet` produces `@media (width >= 48rem)`. Change tokens in the
design document first, then here. The app is light theme only.

Tailwind is enabled the way its official Vite guide describes: the
`@tailwindcss/vite` plugin in `vite.config.ts` and `@import "tailwindcss";` at the
top of `src/index.css`. There is no `tailwind.config.js`; v4 is configured in CSS
(e.g. `@theme`) when needed. Tailwind's base reset lives in `@layer base`, so the
unlayered rules in `index.css` / `App.css` still take precedence over it.

## Testing

```bash
cd frontend
npm test          # Vitest, node environment, mocked fetch, *.test.ts(x)
```

There is no DOM library, so screen tests render components to static HTML
with `react-dom/server` and check what each state shows. Interaction (typing,
clicking, timers) is not tested automatically yet; that needs a DOM test
environment, which is a dependency awaiting approval.

Tests create a client with `createApiClient({ baseUrl, fetch: mockFetch })`; no
server is needed. They cover the health call (URL, method, credentials), JSON
bodies, envelope mapping, non-envelope errors, network errors, aborts, a
missing base URL, and (`auth.test.ts`) storing, sending and clearing the CSRF
token.
