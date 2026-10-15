# Design system

<!-- Recorded from the approved Claude Design canvas. Values are copied from the
canvas source (project/Main.dc.html, version 1792010694-0e07). The only
additions are the decisions recorded under "Decisions".
Workflow: docs/process/ui-driven-development.md -->

Issue: S1-13 (#17) · Requirements: NFR-020, NFR-021 · Prompt:
[prompts/00-design-system.md](prompts/00-design-system.md)
Designer: @nnamdi-security · Reviewed by: @nnamdi-security on 2026-10-14 ·
Status: approved

This is the shared visual system for all three apps: customer (mobile),
staff/dispatcher (desktop first, also mobile) and driver (mobile). Every slice
design (`docs/design/<slice>.md`) reuses it. It sets **how things look**; it
does not set business rules. Example copy on the canvas (quantities, payment
options, time windows, references) is illustration only. See
[Not approved by this design](#not-approved-by-this-design).

## Design link

- Claude Design canvas: <https://claude.ai/artifact/9fKnBVzgvqwm8vx1eU8Y5C#play-15dd8cd198dd>
- Canvas title: "MmiriOma Design System". This system is the "Design system"
  artboard (`Main.dc.html`, 1280 px wide page); the canvas also holds the
  [authentication screens](authentication.md). Footer: "MmiriOma design system v1.0 · Lucide icons ·
  Noto Sans · Tailwind CSS v4 tokens".
- Version approved: `1792010694-0e07`. Version recorded here:
  `1792015088-aba8`, which adds the logo and the sign-in parts (see
  [Additions from the authentication design](#additions-from-the-authentication-design)).
  If the canvas changes again, this document must be updated in a reviewed
  PR.
- No screenshots are committed. The canvas is the visual reference; its
  sections are listed in [Canvas sections](#canvas-sections).

## Principles

From the canvas ("Six rules. Every component follows them."):

| Rule | Meaning |
| --- | --- |
| Plain words | Short sentences. Labels say what will happen: "Order water", not "Submit". |
| Never colour alone | Every status has an icon and words. Errors have an icon, words and a different border. |
| Easy to tap | Buttons and fields are at least 48 px tall, usable with one thumb outdoors. |
| Light on data | No photos. Icons are inline Lucide SVG. One font family, three weights, with a system fallback. |
| Visible focus | A 3 px blue ring on every control reached by keyboard. Every field has a visible label. |
| Honest examples | Mockups that show example names or naira amounts carry the Sample data tag. |

Light theme only. No dark theme was designed.

## Colors

Brand blue-teal is the only brand colour. Neutrals are cool grey. Semantic
colours are used for meaning only. **Primary shades 300 to 500 are for fills and
lines, never for text on white.**

### Brand primary

`600` is the main colour (buttons, links, focus border), `700` is hover, `800`
is pressed.

| Token | HEX | Use |
| --- | --- | --- |
| `--color-primary-50` | `#EEF8FB` | Tint backgrounds (selected tiles, hover, active nav) |
| `--color-primary-100` | `#D4EDF4` | Pressed secondary/ghost button |
| `--color-primary-200` | `#A9DAE8` | Brand badge border |
| `--color-primary-300` | `#74C0D6` | Fills and lines only |
| `--color-primary-400` | `#3FA0BE` | Fills and lines only |
| `--color-primary-500` | `#1D82A3` | Fills and lines only |
| `--color-primary-600` | `#0B6786` | Main brand colour |
| `--color-primary-700` | `#095370` | Hover; secondary and ghost button text |
| `--color-primary-800` | `#08425A` | Pressed; brand badge text; active nav text |
| `--color-primary-900` | `#073647` | Pressed secondary/ghost button text |

### Brand states (aliases)

| Token | HEX | Equals |
| --- | --- | --- |
| `--color-primary` | `#0B6786` | `primary-600`: buttons, links |
| `--color-primary-hover` | `#095370` | `primary-700` |
| `--color-primary-pressed` | `#08425A` | `primary-800` |

### Neutral

`900` is body text, `600` is secondary text, `500` is the border of form
controls.

| Token | HEX |
| --- | --- |
| `--color-neutral-50` | `#F7F9FA` |
| `--color-neutral-100` | `#EEF2F4` |
| `--color-neutral-200` | `#DFE5E9` |
| `--color-neutral-300` | `#C6D0D6` |
| `--color-neutral-400` | `#98A6AF` |
| `--color-neutral-500` | `#6A7983` |
| `--color-neutral-600` | `#4F5C66` |
| `--color-neutral-700` | `#3B464E` |
| `--color-neutral-800` | `#263037` |
| `--color-neutral-900` | `#151D23` |

### Surface, text, border and focus

These are the names to use in components.

| Token | HEX | Use |
| --- | --- | --- |
| `--color-background` | `#F7F9FA` | Page |
| `--color-surface` | `#FFFFFF` | Cards, fields, tables |
| `--color-surface-muted` | `#EEF2F4` | Disabled fill, suffix boxes |
| `--color-text-primary` | `#151D23` | Main text |
| `--color-text-secondary` | `#4F5C66` | Helper text, meta, placeholders |
| `--color-text-disabled` | `#6A7983` | Disabled text (WCAG-exempt) |
| `--color-text-inverse` | `#FFFFFF` | Text on dark fills |
| `--color-border` | `#C6D0D6` | Cards, dividers |
| `--color-border-strong` | `#6A7983` | Inputs, checkboxes (3:1) |
| `--color-focus-ring` | `#2A4BD7` | 3 px focus ring (3:1) |

### Semantic

| Token | HEX | Use |
| --- | --- | --- |
| `--color-success-50` | `#E9F7EF` | Background |
| `--color-success-200` | `#A9DCBF` | Border; icon on dark toast |
| `--color-success-600` | `#1B7A43` | Icon |
| `--color-success-700` | `#14602F` | Text |
| `--color-warning-50` | `#FFF5DC` | Background |
| `--color-warning-200` | `#F5D48A` | Border |
| `--color-warning-500` | `#F2A900` | Solid fill, **dark text only, never white** |
| `--color-warning-700` | `#8A5200` | Icon |
| `--color-warning-800` | `#6B4000` | Text on `warning-50` |
| `--color-danger-50` | `#FDEDEB` | Background; error field fill |
| `--color-danger-200` | `#F4B5AE` | Border; icon on dark toast |
| `--color-danger-600` | `#BE2A1E` | Destructive button; error field border |
| `--color-danger-700` | `#9B1F15` | Error text; destructive hover |
| `--color-danger-800` | `#7C190F` | Destructive pressed |
| `--color-info-50` | `#EAF1FD` | Background |
| `--color-info-200` | `#B4CCF3` | Border |
| `--color-info-600` | `#1F5FBF` | Icon |
| `--color-info-700` | `#184C99` | Text |

Info is a different blue from the brand so the two are never confused.

Other colour values used on the canvas: dialog backdrop
`rgb(21 29 35 / 0.62)`; skeleton shimmer gradient `neutral-100` → `neutral-200`
→ `neutral-100`.

### Contrast (WCAG 2.1 AA)

Text needs 4.5:1; control borders, focus rings and icons need 3:1. The canvas
computes these from the tokens; the ratios below were recomputed from the same
HEX values with the WCAG 2.1 formula and match.

| Pair | Ratio | Needs | Result |
| --- | --- | --- | --- |
| `text-primary` on `surface` | 17.05 : 1 | 4.5 : 1 | Pass |
| `text-primary` on `background` | 16.14 : 1 | 4.5 : 1 | Pass |
| `text-primary` on `surface-muted` | 15.13 : 1 | 4.5 : 1 | Pass |
| `text-secondary` on `surface` | 6.87 : 1 | 4.5 : 1 | Pass |
| `text-secondary` on `background` | 6.51 : 1 | 4.5 : 1 | Pass |
| `text-secondary` on `surface-muted` | 6.10 : 1 | 4.5 : 1 | Pass |
| `text-inverse` on `primary` | 6.37 : 1 | 4.5 : 1 | Pass |
| `text-inverse` on `primary-hover` | 8.46 : 1 | 4.5 : 1 | Pass |
| `text-inverse` on `primary-pressed` | 10.84 : 1 | 4.5 : 1 | Pass |
| `primary-700` on `surface` | 8.46 : 1 | 4.5 : 1 | Pass |
| `primary` on `surface` | 6.37 : 1 | 4.5 : 1 | Pass |
| `primary-800` on `primary-50` | 10.04 : 1 | 4.5 : 1 | Pass |
| `text-inverse` on `danger-600` | 5.93 : 1 | 4.5 : 1 | Pass |
| `text-inverse` on `danger-700` | 8.08 : 1 | 4.5 : 1 | Pass |
| `danger-700` on `surface` | 8.08 : 1 | 4.5 : 1 | Pass |
| `danger-700` on `danger-50` | 7.11 : 1 | 4.5 : 1 | Pass |
| `success-700` on `success-50` | 6.93 : 1 | 4.5 : 1 | Pass |
| `warning-800` on `warning-50` | 8.20 : 1 | 4.5 : 1 | Pass |
| `info-700` on `info-50` | 7.30 : 1 | 4.5 : 1 | Pass |
| `text-primary` on `warning-500` | 8.48 : 1 | 4.5 : 1 | Pass |
| `neutral-700` on `neutral-200` | 7.61 : 1 | 4.5 : 1 | Pass |
| `neutral-800` on `surface` | 13.46 : 1 | 4.5 : 1 | Pass |
| `border-strong` on `surface` | 4.49 : 1 | 3 : 1 | Pass |
| `border-strong` on `background` | 4.25 : 1 | 3 : 1 | Pass |
| `focus-ring` on `surface` | 6.80 : 1 | 3 : 1 | Pass |
| `focus-ring` on `background` | 6.44 : 1 | 3 : 1 | Pass |
| `focus-ring` on `primary-50` | 6.30 : 1 | 3 : 1 | Pass |
| `success-600` on `success-50` | 4.86 : 1 | 3 : 1 | Pass |
| `warning-700` on `warning-50` | 5.88 : 1 | 3 : 1 | Pass |
| `danger-600` on `danger-50` | 5.22 : 1 | 3 : 1 | Pass |
| `info-600` on `info-50` | 5.37 : 1 | 3 : 1 | Pass |
| `text-disabled` on `surface-muted` | 3.99 : 1 | 3 : 1 | Exempt |

Disabled text is exempt from AA, but keeps about 4:1 so it stays readable in
sunlight. Never put essential information in a disabled style.

## Typography

- **Font:** Noto Sans, weights **400, 600 and 700 only**, with the phone's own
  font as fallback. Chosen because it covers Igbo letters such as ọ, ụ, ị
  and ṅ.
- `--font-sans`: `"Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`
- `--font-mono`: `ui-monospace, "SF Mono", Menlo, Consolas, monospace` (codes,
  token names; 14/20 on the canvas)
- The canvas loads Noto Sans from Google Fonts for the mockup. Its guidance for
  production: self-host a Latin subset so the font file stays small. The subset
  **must not** include the Igbo letters (see [Decisions](#decisions)).

| Style | Size / line height | Weight | Token | Example on canvas |
| --- | --- | --- | --- | --- |
| display | 32/40 px | 700 | `--text-display` (2rem / 2.5rem) | "Water, on time" |
| display (desktop) | 40/48 px | 700 | `--text-display-lg` (2.5rem / 3rem) | Page title |
| h1 | 28/36 px | 700 | `--text-h1` (1.75rem / 2.25rem) | "Order water" |
| h2 | 22/30 px | 600 | `--text-h2` (1.375rem / 1.875rem) | "Choose a delivery day" |
| h3 | 18/26 px | 600 | `--text-h3` (1.125rem / 1.625rem) | "Delivery address" |
| body | 16/24 px | 400 | `--text-body` (1rem / 1.5rem) | Paragraph text |
| small | 14/20 px | 400 | `--text-small` (0.875rem / 1.25rem) | Helper text, meta |
| caption | 13/18 px | 400 | `--text-caption` (0.8125rem / 1.125rem) | "Updated Wed 14 Oct 2026, 2:30 pm" |

Rules:

- Body text is 16 px on every screen size.
- Small and caption are for extra detail only, never for the one thing a person
  must read.
- Form labels are body size at weight 600.
- Inputs use 16 px text so phones do not zoom in.

Component text sizes seen on the canvas: button 600 16/24; badge 600 14/20;
tag 700 13/16 upper case with 0.04em letter spacing; card title 700 18/26;
top bar title 700 18/26; dialog title 700 22/30; quantity tile main 700 18/26.

## Spacing, radius and shadows

### Spacing (4 px base)

`--spacing` is `0.25rem` (4 px), so Tailwind's `p-4` is 16 px. Named steps:

| Token | px |
| --- | --- |
| `--spacing-1` | 4 |
| `--spacing-2` | 8 |
| `--spacing-3` | 12 |
| `--spacing-4` | 16 |
| `--spacing-5` | 20 |
| `--spacing-6` | 24 |
| `--spacing-8` | 32 |
| `--spacing-10` | 40 |
| `--spacing-12` | 48 |
| `--spacing-16` | 64 |
| `--spacing-20` | 80 |
| `--spacing-touch` | 48 (minimum touch target) |
| `--spacing-touch-lg` | 56 (driver app primary button and fields; added with the auth design) |

Page gutter on the canvas: 16 px; content max width 1200 px.

### Radius

| Token | Value | Use |
| --- | --- | --- |
| `--radius-sm` | 6 px (0.375rem) | Tags, skeleton blocks |
| `--radius-md` | 10 px (0.625rem) | Buttons, fields |
| `--radius-box` | 12 px (0.75rem) | Quantity tiles, alerts, toasts, dropdown panels, brand mark |
| `--radius-lg` | 14 px (0.875rem) | Cards, tables, list containers |
| `--radius-xl` | 20 px (1.25rem) | Dialogs |
| `--radius-full` | 9999px | Badges, pills |

`--radius-box` was added after approval: the canvas uses 12 px on these
elements but had no token for it (see [Decisions](#decisions)).

### Shadows (subtle)

| Token | Value | Use |
| --- | --- | --- |
| `--shadow-xs` | `0 1px 2px 0 rgb(21 29 35 / 0.06)` | Cards |
| `--shadow-sm` | `0 1px 3px 0 rgb(21 29 35 / 0.08), 0 1px 2px -1px rgb(21 29 35 / 0.06)` | Rows |
| `--shadow-md` | `0 4px 12px -2px rgb(21 29 35 / 0.10), 0 2px 4px -2px rgb(21 29 35 / 0.06)` | Menus, dropdown panel |
| `--shadow-lg` | `0 16px 32px -8px rgb(21 29 35 / 0.20), 0 4px 8px -4px rgb(21 29 35 / 0.10)` | Dialogs, toasts |

## Breakpoints

Min-width breakpoints:

| Name | Token | Width | Behaviour |
| --- | --- | --- | --- |
| mobile | `--breakpoint-mobile` (22.5rem) | 360 px | Phones. One column, full-width buttons, bottom navigation. |
| tablet | `--breakpoint-tablet` (48rem) | 768 px | Two columns. Tables stop scrolling sideways. |
| desktop | `--breakpoint-desktop` (80rem) | 1280 px | Sidebar navigation for dispatchers. Content up to 1200 px wide. |

Below the tablet width the table scrolls sideways inside its box (table min
width 760 px).

## Components

All sizes in px. "Token" names refer to the tables above.

### Buttons

Variants: **primary**, **secondary**, **ghost**, **destructive**. Each was
designed in default, hover, focus, active (pressed), disabled and loading
states.

Shared: min height 48, min width 48, padding 0 20, 2 px border, `radius-md`,
600 16/24, gap 8 between icon and label. Full width on mobile (`btn-block`).

| Variant | Default | Hover | Pressed |
| --- | --- | --- | --- |
| Primary | fill and border `primary`, text white | `primary-hover` | `primary-pressed`, moves down 1 px |
| Secondary | white fill, border `primary`, text `primary-700` | fill `primary-50`, border `primary-hover`, text `primary-800` | fill `primary-100`, border `primary-pressed`, text `primary-900`, down 1 px |
| Ghost | transparent, text `primary-700` | fill `primary-50`, text `primary-800` | fill `primary-100`, text `primary-900`, down 1 px |
| Destructive | fill and border `danger-600`, text white | `danger-700` | `danger-800`, down 1 px |

- **Disabled (all):** fill `surface-muted`, border `border`, text
  `text-disabled`, `not-allowed` cursor; ghost keeps a transparent fill and
  border.
- **Focus (all):** 3 px `focus-ring` outline, 2 px offset.
- **Loading:** a spinner icon is added before the label; the **label stays**
  so the width does not change; `aria-busy="true"`; clicks are blocked.
  Example: "Placing order".
- **Icon button:** 48 × 48, no border, `radius-md`, transparent; hover
  `neutral-100`, pressed `neutral-200`. Always has an `aria-label`.
- Use **one primary button per screen**.

### Form fields

Every field: visible label above (body 600), helper text below (small,
`text-secondary`), error text below (small 600, `danger-700`, with a 16 px
alert-circle icon). Placeholders only show an example and never replace the
label. Gap between label, control and help: 6 px.

Shared control style: min height 48, 2 px border `border-strong`,
`radius-md`, white fill, 16/24 text, padding 10 14.

| State | Style |
| --- | --- |
| Default | border `border-strong` |
| Hover | border `neutral-800` |
| Focus | border `primary` plus 3 px `focus-ring` outline, 2 px offset |
| Error | border `danger-600`, fill `danger-50`, `aria-invalid="true"`, error text linked with `aria-describedby` |
| Disabled | fill `surface-muted`, border `border`, text `text-disabled`, `not-allowed` cursor |

Field types on the canvas:

- **Text input:** all five states above.
- **Textarea:** min height 96, vertical resize; optional fields show
  "(optional)" in the label at weight 400, `text-secondary`.
- **Phone number:** grouped control with a leading phone icon, `type="tel"`,
  `inputmode="tel"`, `autocomplete="tel"`; placeholder `0800 000 0001`;
  display groups 4-3-4 ("Spaces are added as you type"). States: default,
  filled, error, disabled.
- **Number with unit:** grouped control with a `litres` suffix box
  (`surface-muted` fill, 2 px left border, 600 weight, `text-secondary`);
  `inputmode="numeric"`. States: default, focus, error, disabled. The suffix
  border turns `danger-600` on error.
- **Date picker:** native `type="date"` (opens the phone's own picker);
  summaries show the date as "Fri 16 Oct 2026".
- **Select:** native select with a chevron icon on the right (padding-right
  44). States: default, error, **loading** (disabled, spinner in place of the
  chevron, "Loading areas…"), disabled.
- **Radio group and checkbox:** each option is a 48 px tall bordered row
  (2 px `border`, `radius-md`, gap 12) with a 24 × 24 native control using
  `accent-color: primary`. Checked row: border `primary`, fill `primary-50`.
  Disabled row: `surface-muted`, `text-disabled`. Error: border `danger-600`
  on each row and an error message under the group. Groups use
  `fieldset` + `legend`.

### Quantity chooser

Preset tiles first, then "Other amount" ("Type your own") which reveals a
number-with-unit field.

- Tile: min height 72, padding 10 12, 2 px border `border-strong`,
  `radius-box`, white. Main line 700 18/26; sub line 14/20
  `text-secondary`. Grid of tiles at least 150 px wide, gap 8.
- Built as visually hidden radio inputs inside labels.
- States: default; hover (border `neutral-800`, fill `primary-50`); focus
  (3 px ring); **selected** (border `primary`, fill `primary-50`, extra 1 px
  inset border, **check icon** top right, so it is clear without colour);
  disabled (`surface-muted`, `text-disabled`, e.g. "Not available today");
  error, none chosen (border `danger-600`).

The amounts and prices on the canvas tiles are samples, not approved options.

### Status badge

Always an icon plus words; colour is only a hint. Pill (`radius-full`), min
height 28, padding 2 12 2 8, 1 px border, 600 14/20, 16 px icon.

| Label | Style | Lucide icon (shape) |
| --- | --- | --- |
| Request received | info (`info-50` / `info-700` / `info-200`) | inbox |
| Awaiting confirmation | warning (`warning-50` / `warning-800` / `warning-200`) | clock |
| Confirmed | brand (`primary-50` / `primary-800` / `primary-200`) | check |
| Driver assigned | brand | user-check |
| Water collected | brand | droplet |
| On the way | info | truck |
| Delivered | success (`success-50` / `success-700` / `success-200`) | circle-check |
| Cancelled | off (`neutral-200` / `neutral-700` / `neutral-300`) | ban |
| Delivery failed | danger (`danger-50` / `danger-700` / `danger-200`) | circle-x |
| Under review | white fill, `neutral-800` text, **1 px dashed** `neutral-500` border | search |

These ten labels match the "Customer sees it as" column of
[orders.md](../api/orders.md#order-statuses-fr-033). Which status maps to
which label is set by the contract, not by this design.

### Alert / banner

Variants info, success, warning, error; each with or without an action.
Layout: icon, title (700) and body, optional action button (secondary) below
with 8 px top margin. Padding 14 16, 1 px border, `radius-box`, gap 12.

| Variant | Fill / border | Icon and title colour | Icon |
| --- | --- | --- | --- |
| Info | `info-50` / `info-200` | `info-700` | info |
| Success | `success-50` / `success-200` | `success-700` | circle-check |
| Warning | `warning-50` / `warning-200` | `warning-800` | triangle-alert |
| Error | `danger-50` / `danger-200` | `danger-700` | circle-x |

Errors use `role="alert"` (read at once); other alerts use `role="status"`.

### Card

White, 1 px `border`, `radius-lg`, `shadow-xs`, padding 16, gap 12. Head:
title (700 18/26) and status badge, wrapping. Body: key/value list (`dl`,
14/20, keys `text-secondary`, values 600). Foot: 1 px `neutral-200` top
divider, padding-top 12, total (700 18/26) and an action.

### List row

The whole row is the tap target (a link). Min height 72, padding 12 16, 1 px
`neutral-200` divider, white. Leading 40 × 40 icon box (`primary-50` fill,
`primary-700` icon, 10 radius), title (600) and meta (14/20
`text-secondary`), badge, trailing chevron. Hover `neutral-50`, pressed
`neutral-100`. Rows sit in a container with 1 px `border` and `radius-lg`.

### Table

- Wrapper: 1 px `border`, `radius-lg`, white, scrolls sideways; table min width
  760, 14/20 text.
- Header cells: height 48, padding 0 16, fill `neutral-50`, 1 px `border`
  bottom, 600.
- Body cells: padding 12 16, 1 px `neutral-200` divider; row hover
  `neutral-50`. Numbers right aligned.
- **Sortable header:** a real button (min height 48) with an icon: unsorted
  shows arrow-up-down, sorted shows arrow-up (ascending). The `th` carries
  `aria-sort`. The table has a visually hidden caption describing the sort.
- **Empty state:** one full-width row containing the empty-state component
  (e.g. "No orders match your filters." + "Clear filters").
- Demo records carry the **Simulated** tag beside the customer name.

### Pagination

Text "Showing 1-50 of 120" with Previous / Next secondary buttons (chevron
icons). Previous is disabled on the first page; Next is disabled on the last
("Showing 101-120 of 120"). Wrapped in `nav aria-label="Pages"`.

### Filter bar

Wrapping row, gap 12, aligned to the bottom of the fields.

- **Status multi-select:** a secondary button "Status" with a count pill
  (min 24 × 24, `primary` fill, white 700 13/16) and a chevron that rotates
  when open. The panel: up to 320 wide, max height 264 (scrolls), padding 8,
  white, 1 px `border`, `radius-box`, `shadow-md`, real checkboxes in borderless
  choice rows.
- **Date range:** "From" and "To" native date fields, 180 wide.
- **Clear filters:** ghost button with an x icon.

### Empty state

Centred; 56 × 56 round icon (`primary-50` fill, `primary-700` icon, 28 px
icon), one sentence (600, max 32 characters wide), one action button.
Padding 32 16, gap 12.

### Loading

- **Skeletons** for cards, list rows and tables keep the page shape so nothing
  jumps. Blocks: 6 px radius, shimmer `neutral-100`/`neutral-200`, 1.4 s.
  Each skeleton region is `role="status"`, `aria-busy="true"`, with a hidden
  "Loading…" label announced once.
- **Button spinner:** see Buttons. Spinner turns once per 0.9 s.
- Shimmer and spinner animations stop under `prefers-reduced-motion: reduce`.

### Page header

Title (h1 700 28/36), optional subtitle (`text-secondary`) and an optional
primary action, wrapping, gap 16.

### Mobile top bar

Min height 56, padding 4 8, white, 1 px `border` bottom. Back button is a
48 × 48 icon button (`aria-label="Back"`); title 700 18/26, one line with
ellipsis.

### Bottom navigation (mobile)

Three items (canvas: Home, My orders, Account), white, 1 px `border` top.
Each item: min height 64, icon above label, 600 14/20, `text-secondary`.
Current item: `aria-current="page"`, text `primary-800`, weight 700, and a
4 px `primary` bar along the top, so it is not shown by colour alone.

### Sidebar navigation (desktop admin)

240 wide, white, 1 px `border` right, padding 16 12. Brand at top (40 × 40
`primary` mark with droplet icon, `radius-box`; wordmark 700 20/28). Items: min
height 48, padding 0 12, `radius-md`, 600, icon plus label; hover
`neutral-100`; current item `primary-50` fill, `primary-800` text, 700.

### Modal / confirmation dialog

Used before anything that cannot be undone.

- Backdrop `rgb(21 29 35 / 0.62)`; dialog max width 440, padding 24, white,
  `radius-xl`, `shadow-lg`, gap 12.
- Title 700 22/30; close icon button top right (`aria-label="Close"`).
- Actions wrap, gap 12, each at least 150 wide. **The safe choice comes
  first**; the dangerous button says exactly what it does (e.g. "Keep order"
  then "Cancel order").
- `role="dialog"`, `aria-modal="true"`, labelled and described. Focus moves
  into the dialog; Escape closes it.

### Toast

Dark: `neutral-900` fill, white text, `radius-box`, `shadow-lg`, min height 56,
max width 440, padding 8 8 8 16. Icon colour: `success-200` (success) or
`danger-200` (error). Optional ghost action button (white text, hover
`neutral-700`).

- Shows for **about 6 seconds**. A toast **with an action stays** until it is
  used or closed.
- Success uses `role="status"`; error uses `role="alert"`.

### Sample data and Simulated tags

| Tag | Style | Icon | Use |
| --- | --- | --- | --- |
| Sample data | `warning-50` fill, `warning-800` text, 1 px `warning-200` border | info | Any mockup showing example names, numbers or naira amounts |
| Simulated | `neutral-900` fill, white text | flask-conical | Staff screens showing demo records |
| Sample (money chip) | `warning-50` / `warning-800` / `warning-200`, 600 13/16, 6 radius, min height 20 | none | After a sample naira amount: "₦2,000.00 Sample" |

Tags: min height 24, padding 0 8, `radius-sm`, 700 13/16, upper case, 0.04em
spacing. Both tags have an icon and words and are never removed to make a
mockup look cleaner. Canvas example of a demo-records banner (warning alert):
"These are demo records. Orders marked Simulated are for training. No water
will be delivered and no money is taken."

### Icons

Lucide, inline SVG, stroke 2, round caps and joins, `currentColor`. Sizes:
20 (default), 16 (small: badges, tags, errors, table sort), 28 (large: empty
state). Decorative icons are `aria-hidden="true"`.

## Additions from the authentication design

Added on the canvas while designing the
[authentication screens](authentication.md) (version `1792015088-aba8`). They
use the existing colours and type. They are approved together with the
authentication design (G2), not with version 1.0.

### Logo

- **Full logo:** droplet, wave and wordmark (image, 592 × 150, about 9 KB).
  Used on every sign-in, welcome and splash screen; small in tight top bars.
  Smallest width 120 px. Clear space equal to the height of the droplet's wave
  (about a quarter of the logo height).
- **Icon only:** the droplet (image, 151 × 200, about 5 KB), for places
  narrower than 160 px, such as a home-screen icon or an avatar. Smallest
  height 32 px.
- Rules: place it on white (the artwork has a white background); do not
  stretch, recolour, add a shadow or put it on a photo; do not write
  "MmiriOma" again next to the full logo. Staff top bar: logo plus a small
  "Staff" label; driver and customer bars: logo only.
- Both files exist only as uploads on the canvas so far. They must be
  exported into the repository before the frontend uses them.

### Password field

A grouped field with a Show/Hide button inside it on the right: min width 84,
padding 0 12, 2 px left border `border-strong`, fill `surface-muted`, 600
14/20, `primary-700` text, eye / eye-off icon plus the word. Hover fill
`primary-50`. The button sets `aria-pressed` and its `aria-label` ("Show
password" / "Hide password"). On error its left border turns `danger-600`. No
complexity rules; 8 to 128 characters.

States: hidden (default), visible ("Hide"), error, locked.

### Locked field state

While a form is being sent: fill `surface-muted`, border `border`, `progress`
cursor. The typed value stays visible in `text-primary` (not the disabled
colour), so people can see what was sent.

### Large button and sunlight variant (driver app)

- `btn-lg`: min height 56 (`--spacing-touch-lg`), 18/28 text, padding 0 24.
- Sunlight primary (`btn-sun`): fill and border `primary-pressed`
  (`primary-800`, `#08425A`), white text, 10.84 : 1. Hover `primary-900`.
- Driver fields are 56 px tall with 18/28 text and labels, and a
  `neutral-800` border. Driver alerts use 18/28 text.

### Account menu

- Customer: a pill button (min height 48, 2 px `border`, `radius-full`, 600
  16/24) with a user icon, the name (truncated) and a chevron;
  `aria-haspopup="menu"`, `aria-expanded`.
- Driver, and staff below 768 px: a "Menu" button (min height 48, 2 px
  `border`, `radius-md`) with a menu icon.
- The menu card: up to 268 wide, padding 16, white, 1 px `border`,
  `radius-lg`, `shadow-lg`, gap 12. Name (700 18/26); the customer menu also
  shows the phone (14/20 `text-secondary`). A divider, then a full-width
  secondary "Sign out" button with a log-out icon.

### Staff top bar (desktop)

Min height 64, padding 8 24, white, 1 px `border` bottom. Left: logo (150 px)
and a "Staff" label (`surface-muted` fill, `neutral-800` text, `border`).
Right: user icon and name (600), then a secondary "Sign out" button. Below
768 px it becomes the Menu button above.

### Splash (checking session)

Centred logo (240 px, up to 80% wide) and a 28 px spinner in `primary`, gap
20, with a hidden "Checking your session" label and `role="status"`.

## Formatting rules

Times are Africa/Lagos (West Africa Time, UTC+1), **12-hour clock with am/pm**.

| Rule | Write | Not |
| --- | --- | --- |
| Money: ₦ first, commas, always 2 decimals; in mockups always add Sample | ₦2,000.00 Sample | N2000 · NGN 2,000 · ₦2000 |
| Date: weekday, day, short month, year | Fri 16 Oct 2026 | 16/10/2026 · October 16th |
| Time: 12-hour, lower-case am/pm, no leading zero | 9:00 am · 2:30 pm | 09:00 · 14:30 · 2:30 PM |
| Time window: "to", not a dash | 9:00 am to 12:00 pm | 9-12 · 9:00 am – 12:00 pm |
| Day and time together: date, comma, time | Fri 16 Oct 2026, 9:00 am to 12:00 pm | 16 Oct 9am |
| Today and tomorrow: the word, then the date in small text | Today · Wed 14 Oct 2026 | 0 days |
| Water: number, space, "litres"; commas from 1,000 | 1,000 litres | 1000L · 1000 ltrs |
| Phone (display): 11 digits grouped 4, 3, 4 | 0800 000 0001 | +2348000000001 · 08000000001 |

Money is stored as whole kobo and times in UTC; format only for display. Do
not show "WAT" unless the person is outside Nigeria.

The canvas also shows an order-number rule ("MO-1042"). That conflicts with
the contract; see below.

## Accessibility requirements

From the prompt rules and the canvas (NFR-020, NFR-021):

- WCAG 2.1 AA contrast for every text/background pair (table above); 3:1 for
  control borders, focus rings and icons.
- Touch targets at least **48 × 48** for every interactive control (buttons,
  fields, choice rows, table sort buttons, nav items, icon buttons).
- Visible focus: 3 px `focus-ring` (`#2A4BD7`) outline, 2 px offset, on every
  focusable control (`:focus-visible`).
- Keyboard operable; real `button`, `a`, `input`, `select`, `label` elements.
- Every input has a visible label; no placeholder-only labels. Errors are
  linked with `aria-describedby` and marked `aria-invalid="true"`.
- Status is never shown by colour alone: badges have icon plus words; errors
  have icon, words and a different border; selected tiles have a tick; current
  nav items have weight and a bar.
- Icon-only buttons have an `aria-label`.
- Errors announce with `role="alert"`; other alerts, toasts and loading regions
  use `role="status"`; loading regions set `aria-busy`.
- Dialogs: `aria-modal`, focus moved inside, Escape closes.
- Reduced motion: shimmer and spinner animations stop.
- Disabled text is WCAG-exempt but kept near 4:1; never put essential
  information in a disabled style.

## Tailwind CSS v4 theme

The canvas's final token table, as its `@theme` block (to paste after
`@import "tailwindcss";`). Per the canvas, `--color-primary-600` gives
`bg-primary-600`, `--radius-md` gives `rounded-md`, `--breakpoint-tablet`
gives the `tablet:` variant, and `--spacing` is the 4 px base. This goes into
`frontend/src/index.css` in the first frontend PR that uses it (prompt 00),
not before.

```css
@theme {
  /* Color: brand primary */
  --color-primary-50: #EEF8FB;
  --color-primary-100: #D4EDF4;
  --color-primary-200: #A9DAE8;
  --color-primary-300: #74C0D6;
  --color-primary-400: #3FA0BE;
  --color-primary-500: #1D82A3;
  --color-primary-600: #0B6786;
  --color-primary-700: #095370;
  --color-primary-800: #08425A;
  --color-primary-900: #073647;

  /* Color: brand states */
  --color-primary: #0B6786;
  --color-primary-hover: #095370;
  --color-primary-pressed: #08425A;

  /* Color: neutral */
  --color-neutral-50: #F7F9FA;
  --color-neutral-100: #EEF2F4;
  --color-neutral-200: #DFE5E9;
  --color-neutral-300: #C6D0D6;
  --color-neutral-400: #98A6AF;
  --color-neutral-500: #6A7983;
  --color-neutral-600: #4F5C66;
  --color-neutral-700: #3B464E;
  --color-neutral-800: #263037;
  --color-neutral-900: #151D23;

  /* Color: surface, text, border, focus */
  --color-background: #F7F9FA;
  --color-surface: #FFFFFF;
  --color-surface-muted: #EEF2F4;
  --color-text-primary: #151D23;
  --color-text-secondary: #4F5C66;
  --color-text-disabled: #6A7983;
  --color-text-inverse: #FFFFFF;
  --color-border: #C6D0D6;
  --color-border-strong: #6A7983;
  --color-focus-ring: #2A4BD7;

  /* Color: semantic */
  --color-success-50: #E9F7EF;
  --color-success-200: #A9DCBF;
  --color-success-600: #1B7A43;
  --color-success-700: #14602F;
  --color-warning-50: #FFF5DC;
  --color-warning-200: #F5D48A;
  --color-warning-500: #F2A900;
  --color-warning-700: #8A5200;
  --color-warning-800: #6B4000;
  --color-danger-50: #FDEDEB;
  --color-danger-200: #F4B5AE;
  --color-danger-600: #BE2A1E;
  --color-danger-700: #9B1F15;
  --color-danger-800: #7C190F;
  --color-info-50: #EAF1FD;
  --color-info-200: #B4CCF3;
  --color-info-600: #1F5FBF;
  --color-info-700: #184C99;

  /* Font */
  --font-sans: "Noto Sans", system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;

  /* Type scale */
  --text-display: 2rem;
  --text-display--line-height: 2.5rem;
  --text-display--font-weight: 700;
  --text-display-lg: 2.5rem;
  --text-display-lg--line-height: 3rem;
  --text-display-lg--font-weight: 700;
  --text-h1: 1.75rem;
  --text-h1--line-height: 2.25rem;
  --text-h1--font-weight: 700;
  --text-h2: 1.375rem;
  --text-h2--line-height: 1.875rem;
  --text-h2--font-weight: 600;
  --text-h3: 1.125rem;
  --text-h3--line-height: 1.625rem;
  --text-h3--font-weight: 600;
  --text-body: 1rem;
  --text-body--line-height: 1.5rem;
  --text-body--font-weight: 400;
  --text-small: 0.875rem;
  --text-small--line-height: 1.25rem;
  --text-small--font-weight: 400;
  --text-caption: 0.8125rem;
  --text-caption--line-height: 1.125rem;
  --text-caption--font-weight: 400;

  /* Spacing (4 px base) */
  --spacing: 0.25rem;
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
  --spacing-3: 0.75rem;
  --spacing-4: 1rem;
  --spacing-5: 1.25rem;
  --spacing-6: 1.5rem;
  --spacing-8: 2rem;
  --spacing-10: 2.5rem;
  --spacing-12: 3rem;
  --spacing-16: 4rem;
  --spacing-20: 5rem;
  --spacing-touch: 3rem;
  --spacing-touch-lg: 3.5rem;

  /* Radius */
  --radius-sm: 0.375rem;
  --radius-md: 0.625rem;
  --radius-box: 0.75rem;
  --radius-lg: 0.875rem;
  --radius-xl: 1.25rem;
  --radius-full: 9999px;

  /* Shadow */
  --shadow-xs: 0 1px 2px 0 rgb(21 29 35 / 0.06);
  --shadow-sm: 0 1px 3px 0 rgb(21 29 35 / 0.08), 0 1px 2px -1px rgb(21 29 35 / 0.06);
  --shadow-md: 0 4px 12px -2px rgb(21 29 35 / 0.10), 0 2px 4px -2px rgb(21 29 35 / 0.06);
  --shadow-lg: 0 16px 32px -8px rgb(21 29 35 / 0.20), 0 4px 8px -4px rgb(21 29 35 / 0.10);

  /* Breakpoints */
  --breakpoint-mobile: 22.5rem;
  --breakpoint-tablet: 48rem;
  --breakpoint-desktop: 80rem;
}
```

## Canvas sections

The canvas page is one long reference with these sections, in order:
Principles · Colour (swatches and contrast check) · Type · Space, radius,
shadow (and breakpoints) · Buttons (4 variants × 6 states, full width on
mobile, with icon and icon only) · Forms (text input, textarea, phone, number
with unit, date and select, radio and checkbox, quantity chooser) · Status and
alerts · Cards, lists, tables (card, list rows, sortable table, pagination,
empty table) · Filters, empty, loading · Navigation (page header, top bar,
bottom nav, sidebar) · Dialog and toast · Tags · Sign-in parts (password
field, large and sunlight buttons, account menu, staff top bar, splash) ·
Money and time · All tokens (table and `@theme` block). A Logo section follows
Principles.

## Not approved by this design

The canvas uses example content to show components. These examples are
**not** approved business rules or copy. The SRS and `docs/api/` decide them;
where they conflict, the SRS and contracts win.

| Canvas example | Conflict or status | Source of truth |
| --- | --- | --- |
| Quantity presets 500 / 1,000 / 2,000 / 5,000 litres; helper "Between 500 and 10,000 litres"; error "The smallest order is 500 litres" | SRS pilot defaults are 25, 50, 100, 200, 300 and 500 L, pending approval; Sprint 1 treats every quantity as a quote request (1–100000) | FR-021; [orders.md](../api/orders.md) field rules |
| Order number "MO-1042" and the rule "MO, a hyphen, 4 digits or more" | Contract reference is `MO-` plus 10 random Crockford base32 characters | [orders.md](../api/orders.md) Reference (FR-027) |
| Payment radio: "Pay when the water arrives", "Pay by bank transfer", "Pay by card (not available yet)" | Payment method is an open decision; FR-040 lists only cash on delivery and bank transfer, no card | SRS §12.5, FR-040 |
| Delivery time select: Morning 8:00 am to 12:00 pm, Afternoon 12:00 pm to 4:00 pm, Evening 4:00 pm to 7:00 pm | Windows are admin-configured; Sprint 1 has a preferred date only, no slots | FR-025; orders.md `preferred_delivery_date` |
| Driver note "Use 200 letters or fewer" | `delivery_instructions` allows up to 500 characters (`landmark` 200) | orders.md field rules |
| Phone helper "Use 11 digits" and error "This number is too short. Use 11 digits." | The auth design uses "Enter a Nigerian mobile number, for example 08000000001"; the API also accepts `234…` and `+234…` input | [04-authentication.md](prompts/04-authentication.md); [auth.md](../api/auth.md) |
| Checkbox "Driver unloads the water for me" | Unloading is part of every delivery, not an option | PRD §1, §3.1 |
| Checkbox "Send updates by email (not available yet)" | Not in the SRS | None |
| "Prices include unloading"; sample prices on tiles, cards and table | Prices come only from the server; Sprint 1 has no prices | FR-022; process honesty rules |
| Sidebar items Overview, Orders, Drivers, Customers; "Below 1280 px it moves to the bottom navigation" | The admin prompt specifies Orders plus greyed later items, and a top bar with a menu button on mobile | [02-admin-orders.md](prompts/02-admin-orders.md) Screen 2 |
| Badge "Driver assigned" | Customers see it only after the driver accepts (`accepted`); before that they see "Confirmed". Staff screens need labels for `assigned` vs `accepted` that this set does not include | orders.md statuses; FR-032 |

## Decisions

Made by the technical lead on 2026-10-14, after the canvas was approved:

1. **Designer and sign-off.** @nnamdi-security made the canvas and approved
   it. Prompt 00 also asks the customer and admin designers (@Cloudcrackamara
   and @Daveoski, S1-13 owners) to agree; they were not available, so their
   review is still outstanding. Raise any change they request as a design
   system change (see the last section).
2. **File location.** This file lives at `docs/design/design-system.md`, where
   prompt 00, the template and the G2 check expect it.
3. **Font subset.** The self-hosted production font is a Latin subset that
   **does not** include the Igbo letters ọ, ụ, ị and ṅ. Those characters fall
   back to the phone's system font (`--font-sans` stack). Self-hosting the font
   file is agreed in the first frontend PR that adds it.
4. **12 px radius.** Added `--radius-box` (12 px, `0.75rem`) for the elements
   the canvas draws at 12 px: quantity tiles, alerts, toasts, dropdown panels
   and the brand mark. It is in the radius table and the `@theme` block. The
   canvas itself does not name it yet.

## Open questions

1. **Staff status labels.** Staff views (prompt 02) need badges for
   "Assigned - awaiting driver", "Driver accepted" and "Disputed". The admin
   design should add them to this system.
2. **Staff navigation below desktop.** The sidebar note says it "moves to the
   bottom navigation" below 1280 px; the staff top bar note says it becomes a
   Menu button below 768 px, which matches prompt 02. The admin design should
   settle one rule.
3. **Touch target size in PR #15.** `docs/design/ui-system.md` in PR #15 uses
   44 px; this approved system uses 48 px.

## Changes to the design system

- Version 1.0 (`1792010694-0e07`), approved 2026-10-14, plus `--radius-box`
  (Decision 4).
- Authentication additions (`1792015088-aba8`): logo, password field, locked
  state, large and sunlight buttons, account menu, staff top bar, splash,
  `--spacing-touch-lg`. Approved with the authentication design.

Future changes: update the canvas, then this file, in one reviewed PR.
