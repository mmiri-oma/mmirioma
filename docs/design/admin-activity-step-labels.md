# Driver step names in Recent activity design

<!-- Workflow: docs/process/ui-driven-development.md. Fork gates: CLAUDE.md,
"Team workflow". -->

Issue: [#275](https://github.com/mmiri-oma/mmirioma/issues/275) (item 3) ·
Requirements: FR-030, NFR-004 · Contract: none changed
([admin-operations.md](../api/admin-operations.md), `GET /admin/activity`) ·
Related: the order timeline's step lines (#242)
Designer: @nnamdi-security (decision on #275) + Claude Code · Reviewed by:
@nnamdi-security (technical lead), 2026-11-01 · Status: approved

The dashboard's Recent activity worded every driver step through the shared
admin status label: departed read "Loading", and collected, en route, arrived
and unloading all read "Demo Driver moved MO-48NK to On the way". The
click-through on #275 saw that line three times in a row, and a dispatcher
could not tell the steps apart. The order timeline already names each step. This record makes the
feed use the same names. It changes no layout, adds no line and changes no
other screen.

## Design link

No preview and no prompt: the change is the last word of an existing sentence,
and the table below lists every case. The words come from the order timeline
(`PROGRESS_LABEL` in `frontend/src/features/admin/real/orders.ts`); none are
new.

## Screens and states

| Screen | States designed | Build now / design ahead |
| --- | --- | --- |
| Dashboard, Recent activity (`a-dashboard`) | **A. A driver step with a named driver:** "Demo Driver moved MO-48NK to Departed", "... to Collected", "... to En route", "... to Arrived", "... to Unloading". **B. A driver step with no actor:** "MO-48NK is now En route" (the existing sentence for no actor). **C. Every other status** (for example Assigned, Cancelled, Delivery failed): unchanged, still the status label. **D. New order, accepted and delivered:** unchanged, they keep their own sentences | Build now |
| Mock mode (`VITE_USE_MOCKS=true`) | Unchanged: the mock writes its own activity lines | Build now |

## Screen-to-endpoint table

All paths are under `/api/v1`.

| Screen | Element / action | Endpoint | Fields used |
| --- | --- | --- | --- |
| Recent activity | One line per item | `GET /admin/activity` ([admin-operations.md](../api/admin-operations.md)) | `kind`, `to_status`, `actor.name`, `order_reference`; unchanged |

## Wording to approve

| `to_status` | Before | After |
| --- | --- | --- |
| `departed` | moved ... to Loading | moved ... to Departed |
| `collected` | moved ... to On the way | moved ... to Collected |
| `en_route` | moved ... to On the way | moved ... to En route |
| `arrived` | moved ... to On the way | moved ... to Arrived |
| `unloading` | moved ... to On the way | moved ... to Unloading |

## Decisions

1. Use the order timeline's step names in the existing sentence, so a step keeps
   one name across the admin app (technical lead on #275, 2026-11-01).
2. Arrived and Unloading change too, so every driver step has its own label, not
   only the three the issue found.
3. No new words: the feed reads the timeline's names through one function
   (`progressStepLabel`), so the two cannot drift apart.

## Approval

G2 approved by @nnamdi-security (technical lead) on #275, 2026-11-01: "Use the
step names the order timeline already uses, in the existing sentence ... Do the
same for Arrived and Unloading, so every driver step has its own label."
