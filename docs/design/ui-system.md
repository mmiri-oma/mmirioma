# MmiriOma UI components

Issue: S1-09 (#10) · Tokens and visual rules: [design-system.md](design-system.md)
(approved, S1-13)

This file lists the React components that implement the approved design
system. It sets no tokens or visual rules of its own: those live only in
[design-system.md](design-system.md), and `frontend/src/index.css` copies its
`@theme` block unchanged. The earlier PR #15 token set (oklch `brand-*`, `ink`,
`canvas`, `line`, 44 px touch targets) was replaced by the approved system
(S1-13 acceptance criterion: one system).

Stack: Tailwind CSS v4 and lucide-react only. There is no UI kit.

## Components

| Component | File | Design-system section |
| --- | --- | --- |
| `Button` | `components/ui/Button.tsx` | Buttons: `primary` (one per screen), `secondary`, `ghost`, `destructive`, `icon` (48 × 48, needs `aria-label`); `loading` keeps the label and adds a spinner |
| `buttonClasses` | `components/ui/buttonVariants.ts` | Button styling for router `<Link>`s |
| `Badge` | `components/ui/Badge.tsx` | Status badge: tones `info`, `warning`, `brand`, `success`, `off`, `danger`, `review` (dashed); `wrap` lets a long label wrap in narrow table columns |
| `PhoneState`, `PhoneStateBadge` | `features/admin-orders/PhoneState.tsx` | "Phone confirmed" / "Phone not confirmed" line and badge (admin design, phone state line) |
| `Tag` | `components/ui/Tag.tsx` | Sample data and Simulated tags |
| `Card` | `components/ui/Card.tsx` | Card |
| `Input` | `components/ui/Input.tsx` | Form fields (text, date, search); `invalid` sets `aria-invalid` and the error style |
| `Skeleton` | `components/ui/Skeleton.tsx` | Loading; pair with a `role="status"` label |
| `StateMessage` | `components/ui/StateMessage.tsx` | Empty state; `tone="error"` for errors (`role="alert"`) |
| `AdminShell` | `components/layout/AdminShell.tsx` | Sidebar navigation (desktop admin), top bar below 1280 px |
| `OrderStatusBadge`, `SimulatedBadge` | `features/admin-orders/OrderStatusBadge.tsx` | Status badge and Simulated tag for orders |

`cn()` (`lib/cn.ts`) joins class names. `lib/format.ts` follows the design
system's formatting rules: `Fri 16 Oct 2026`, `Wed 14 Oct 2026, 10:30 am`,
`1,000 litres`, Lagos time.

## Rules that apply in code

- Every interactive control is at least 48 px (`min-h-touch`), including
  `sm` buttons, filter toggles and nav items.
- Use the semantic tokens (`text-text-primary`, `text-text-secondary`,
  `bg-surface`, `border-border`, `border-border-strong`) rather than raw
  neutrals for text, surfaces and borders.
- Breakpoints are the design system's `tablet:` (768 px) and `desktop:`
  (1280 px); do not use Tailwind's default `sm`/`md`/`lg` in new code.
- Spinners and skeleton shimmer use `motion-safe:` so they stop under reduced
  motion.

## Order status language

Staff labels live in `features/admin-orders/orderStatus.ts`. Tones and icons
follow the design system's badge for the matching customer label
(`docs/api/orders.md`). `assigned` reads "Assigned, not accepted" for staff,
because it must never look like driver acceptance (FR-032). The staff labels
for `assigned`, `accepted` and `disputed` are design-system open question 1,
to be settled by the admin design (S1-08).

## Not yet aligned (waits for the S1-08 admin design)

- Status filter: the design system's filter bar uses a "Status" multi-select
  panel; the directory still uses toggle buttons.
- Staff navigation below 1280 px (design-system open question 2).
- Logo files and the staff top bar from the authentication design: the logo
  is not exported into the repository yet.
- Noto Sans is not self-hosted yet (Decision 3); the system font is used.

## Screens and states

| Screen | Route | States |
| --- | --- | --- |
| Order directory | `/admin/orders` | loading, list, filtered, no results, no orders, error, invalid date range, page out of range |
| Order detail | `/admin/orders/:reference` | loading, detail, not found, error |

To review states with the mock data, add `?mock=empty`, `?mock=error` or
`?mock=slow` to the directory URL.
