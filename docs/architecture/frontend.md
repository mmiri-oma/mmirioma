# Frontend API client

How the React app calls the backend. All API calls go through
`src/lib/api/client.ts`; components must not call `fetch` directly.

Versions this document was written against: React 19.2, TypeScript 6.0,
Vite 8.3, Vitest 5.0.

## Files

| File                              | Responsibility                                         |
| --------------------------------- | ------------------------------------------------------ |
| `src/lib/api/client.ts`           | `createApiClient`, the shared `apiClient`, `ApiError`  |
| `src/lib/api/health.ts`           | Typed `getHealth()` for `GET /api/v1/health`           |
| `src/components/ApiStatus.tsx`    | Shows API reachability (in the admin sidebar)          |
| `src/main.tsx`, `src/App.tsx`     | Providers (TanStack Query, router) and the route table |
| `src/lib/queryClient.ts`          | Query client defaults (retry policy)                   |
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

- `credentials: 'include'` on every request, so cookies will be sent once
  cookie-based authentication exists. The backend allows this only for the exact
  `FRONTEND_URL` origin.
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

## Example component

`ApiStatus` calls `getHealth` once on mount and shows loading, success, or the
`ApiError` message. It aborts the request on unmount. In development, React
StrictMode mounts components twice, so the first request is aborted and its
result ignored. It still uses `useEffect`; new data fetching uses TanStack Query
(see below).

## App shell, routing and data fetching

`main.tsx` wraps the app in `QueryClientProvider` and `BrowserRouter`; `App.tsx`
holds the route table. Server data is read with TanStack Query hooks inside each
feature (e.g. `features/admin-orders/useAdminOrders.ts`), passing the query's
`signal` through to the API call. `createQueryClient()` retries network and 5xx
failures once and never retries 4xx errors (a 404 will not fix itself). Window
focus refetching is off to save mobile data.

Shared tokens and components: [docs/design/ui-system.md](../design/ui-system.md).

## Styling (Tailwind CSS v4)

Tailwind is enabled the way its official Vite guide describes: the
`@tailwindcss/vite` plugin in `vite.config.ts` and `@import "tailwindcss";` at the
top of `src/index.css`. There is no `tailwind.config.js`; v4 is configured in CSS
(e.g. `@theme`) when needed. Tailwind's base reset lives in `@layer base`, so the
unlayered rules in `index.css` / `App.css` still take precedence over it.

## Testing

```bash
cd frontend
npm test          # Vitest; node by default, jsdom for component tests
```

Component tests opt in to a DOM with `// @vitest-environment jsdom` at the top
of the file and use Testing Library (`@testing-library/react`, `user-event`).

Tests create a client with `createApiClient({ baseUrl, fetch: mockFetch })`; no
server is needed. They cover the health call (URL, method, credentials), JSON
bodies, envelope mapping, non-envelope errors, network errors, aborts, and a
missing base URL.
