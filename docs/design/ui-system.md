# MmiriOma UI system

Issue: S1-08 (#9) · Status: proposed, awaiting lead approval

One visual system for the customer, admin and driver screens. Build new screens
from these tokens and components instead of adding a second set. Stack: Tailwind
CSS v4 and lucide-react only. There is no UI kit; the components below are small
Tailwind components owned by the team.

## Principles

- **Low bandwidth first** (PRD §9): system fonts, no images, no web fonts.
- **Touch first:** interactive controls are at least 44 px tall (`min-h-11`); compact controls use 36 px (`min-h-9`).
- **Never colour alone** (NFR-021): every status has an icon and text.
- **Every async view has loading, empty and error states** (NFR-022).
- **Honest data:** simulated records show a "Simulated" badge, and mock screens show a sample-data notice (BR-09). Show no prices unless they come from the server (FR-022). Use no tracking language beyond what the status means (FR-037).

## Tokens (`frontend/src/index.css`, `@theme`)

| Token | Utility examples | Use |
| --- | --- | --- |
| `--color-brand-50…950` | `bg-brand-600`, `text-brand-700` | Primary actions, links, focus ring, admin sidebar (`brand-950`) |
| `--color-ink`, `--color-ink-muted` | `text-ink`, `text-ink-muted` | Body text, secondary text |
| `--color-surface`, `--color-canvas` | `bg-surface`, `bg-canvas` | Cards, page background |
| `--color-line` | `border-line`, `divide-line` | Borders and dividers |
| `--radius-card`, `--shadow-card` | `rounded-card`, `shadow-card` | Card surfaces |
| `--font-sans`, `--font-mono` | `font-mono` | Order references use mono |

Semantic tones use Tailwind's palette through `Badge` tones: `success` (emerald),
`warning` (amber), `danger` (rose), `info` (sky), `violet`, `neutral` (slate).

## Components

| Component | File | Use |
| --- | --- | --- |
| `Button` | `components/ui/Button.tsx` | `primary` (one per screen), `secondary`, `ghost`; sizes `md` (44 px) and `sm` |
| `buttonClasses` | `components/ui/buttonVariants.ts` | Button styling for router `<Link>`s |
| `Badge` | `components/ui/Badge.tsx` | Status or attribute label with an icon and a tone |
| `Card` | `components/ui/Card.tsx` | Grouped content with an optional titled header |
| `Input` | `components/ui/Input.tsx` | Text, date and search fields; `invalid` sets `aria-invalid` |
| `Skeleton` | `components/ui/Skeleton.tsx` | Loading placeholders; pair with a `role="status"` label |
| `StateMessage` | `components/ui/StateMessage.tsx` | Empty, not-found and error states with a recovery action |
| `AdminShell` | `components/layout/AdminShell.tsx` | Admin layout: sidebar on `lg`, top bar below |
| `OrderStatusBadge`, `SimulatedBadge` | `features/admin-orders/OrderStatusBadge.tsx` | Order status (FR-033 meanings) and the simulated flag |

`cn()` (`lib/cn.ts`) joins class names. Formatting helpers (`lib/format.ts`)
show Lagos times, calendar dates and litres.

## Order status language

Staff labels live in `features/admin-orders/orderStatus.ts`. Customer screens
use the customer wording in `docs/api/orders.md` and reuse the same icon and tone
for each status. `assigned` reads "Assigned, not accepted" for staff, because it
must never look like driver acceptance (FR-032).

## Screens and states

| Screen | Route | States |
| --- | --- | --- |
| Order directory | `/admin/orders` | loading, list, filtered, no results, no orders, error, invalid date range, page out of range |
| Order detail | `/admin/orders/:reference` | loading, detail, not found, error |

To review states with the mock data, add `?mock=empty`, `?mock=error` or
`?mock=slow` to the directory URL. The layout switches at `md` (table and cards)
and `lg` (sidebar).
