# Frontend conventions (React, TypeScript, Vite, Tailwind)

Official docs (match `frontend/package.json`): React https://react.dev/ ·
TypeScript https://www.typescriptlang.org/docs/ · Vite https://vite.dev/guide/ ·
Tailwind CSS v4 https://tailwindcss.com/docs/ · Vitest https://vitest.dev/

## Structure

```
frontend/src/
  lib/api/client.ts        # the only place that calls fetch
  lib/api/<module>.ts      # one typed function per endpoint (pattern: health.ts)
  components/              # shared components
  features/<feature>/      # feature components and hooks
```

## API access

- Use `apiClient` and typed endpoint functions only; components never call `fetch`.
- Handle `ApiError` by `code`; show `message` to the user; ignore `AbortError`.
- Response types are not validated at runtime: use Zod for data that drives money, permissions, or state.
- `VITE_*` variables are public. Never put secrets there.
- Data fetching: TanStack Query (provider in `main.tsx`); pass the query `signal` to the API call. Forms: React Hook Form + Zod.

## Product requirements that affect UI (PRD §9, SRS §7.3)

- Mobile-first, for low-bandwidth entry-level Android browsers; responsive admin.
- Every mutation shows loading, success, and error states, and prevents double-submit (NFR-022). Send an idempotency key with order creation (FR-026).
- Keep non-sensitive form input after recoverable errors (NFR-012).
- Show the final all-inclusive price from the server; never calculate authoritative prices in the browser (FR-022–023).
- Format kobo as naira for display only. Show times in Africa/Lagos.
- No false real-time tracking claims (FR-037). Never present awaiting-confirmation as guaranteed (FR-027).
- Accessibility: labels, keyboard support, sufficient contrast, status not conveyed by colour alone (NFR-021).

## React

- Function components and hooks. Small, focused components; extract reusable hooks.
- Satisfy `eslint-plugin-react-hooks`. Never disable a rule without a written reason.
- Effects only sync with external systems. Derive state during render. Async effects clean up with `AbortController`.

## TypeScript

- No `any`: use `unknown` and narrow. Avoid non-null `!`.
- `verbatimModuleSyntax` is on: use `import type` for type-only imports.
- `erasableSyntaxOnly` is on: no `enum`, `namespace`, or constructor parameter properties. Use union types.

## Styling

- Tailwind v4 via `@tailwindcss/vite`; configured in CSS (`@import "tailwindcss";`, `@theme`). Do not add `tailwind.config.js`.
- No new CSS frameworks or UI kits without approval.
