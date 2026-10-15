# Prompt 00: shared design system

**Use first**, before any screen prompt. Customer (S1-04) and admin (S1-08)
designs must both build on its result, so there is one visual system, not two.

Paste everything inside the block into Claude Design.

```text
Create a design system for MmiriOma, a water delivery service in Enugu, Nigeria.

ABOUT THE PRODUCT
MmiriOma ("mmiri" means water in Igbo) lets households and small businesses
order water deliveries from a phone browser. Staff (dispatchers) manage orders
on a laptop or phone, and delivery drivers use their phones. The promise is
convenience, reliable scheduled arrival, transparent pricing, and drivers who
do the unloading so customers never lift water.

USERS AND DEVICES
- Customers: mostly entry-level Android phones, slow or unstable mobile data,
  bright outdoor light. Some have limited reading confidence.
- Dispatchers: laptop first, but must also work on a phone.
- Drivers: phones, often outdoors, one hand free.

DESIGN DIRECTION
- Calm, trustworthy, practical. Water-inspired, but no stock photos of glasses
  of drinking water and no imagery suggesting purity or health benefits.
- Light theme first. Lightweight: no heavy illustrations or large images
  (low bandwidth).
- Plain English labels; short sentences.

WHAT TO PRODUCE
1. Color tokens with names and hex values: brand primary and its hover/pressed
   shades, neutral scale, surface/background, text (primary, secondary,
   disabled), border, focus ring, and semantic colors for success, warning,
   danger and info. Every text/background pair must meet WCAG 2.1 AA contrast.
2. Typography: one widely available sans-serif with a system-font fallback,
   and a type scale (display, h1, h2, h3, body, small, caption) with sizes,
   line heights and weights. Body text at least 16px on mobile.
3. Spacing scale (4px base), border radii, shadows (subtle), and breakpoints
   (mobile 360px, tablet 768px, desktop 1280px).
4. Components, each showing default, hover, focus, active, disabled, loading
   and error states where they apply:
   - Buttons: primary, secondary, ghost, destructive; full-width on mobile.
     Touch targets at least 48x48px.
   - Text input, textarea, phone number input (Nigerian format, e.g.
     0800 000 0001), number input with unit ("litres"), date picker, select,
     radio group, checkbox. Each with label, helper text and inline error text.
   - Quantity chooser: preset choices plus "Other amount".
   - Status badge: text plus an icon, never color alone. Show these variants:
     Request received, Awaiting confirmation, Confirmed, Driver assigned,
     Water collected, On the way, Delivered, Cancelled, Delivery failed,
     Under review.
   - Alert/banner: info, success, warning, error, each with an optional action.
   - Card, list row, table (with sortable header and empty state), pagination
     ("Showing 1-50 of 120", previous/next).
   - Filter bar: status multi-select, date range, clear filters.
   - Empty state: icon, one sentence, one action.
   - Loading: skeletons for cards, list rows and tables; button spinner.
   - Page header, mobile top bar with back button, bottom navigation (mobile),
     sidebar navigation (desktop admin).
   - Modal/confirmation dialog and toast.
   - "SAMPLE DATA" tag, used on any mockup showing example names, numbers or
     naira amounts.
   - "Simulated" tag for staff views of demo records.
5. Money and time formatting rules shown as examples: naira as "₦2,000.00"
   (always labelled "Sample" in mockups), dates like "Fri 16 Oct 2026", times
   in 24-hour or am/pm (pick one) for Africa/Lagos.

RULES
- Accessibility: AA contrast, visible focus rings, keyboard operable, every
  input has a visible label (no placeholder-only labels), status never shown by
  color alone.
- Use icons from the lucide icon set.
- Name tokens so they map directly to Tailwind CSS v4 theme variables (for
  example --color-primary-600, --radius-md, --spacing-4). List all tokens in a
  final table, ready to paste into a CSS @theme block.

Show the system on a single reference page with every component and state.
```

## After generating

1. Refine until both the customer and admin designers agree on it.
2. Record it in `docs/design/design-system.md` (template:
   [../_template.md](../_template.md)), including the final token table.
3. The token table becomes `frontend/src/index.css` `@theme` values in the
   first frontend PR that uses it.
