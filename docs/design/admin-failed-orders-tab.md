# Admin "Delivery failed" tab design

<!-- Workflow: docs/process/ui-driven-development.md. Fork gates: CLAUDE.md,
"Team workflow". -->

Issue: [#273](https://github.com/mmiri-oma/mmirioma/issues/273) ·
Requirements: FR-038, FR-030 · Contract: no change (`GET /admin/orders` already
accepts `status=failed`; see [deliveries.md](../api/deliveries.md)) · Related:
[driver-arrival-unreachable.md](driver-arrival-unreachable.md) (#250),
[admin-order-contact-attempts.md](admin-order-contact-attempts.md) (#280)
Decided by: @nnamdi-security (technical lead), on #273 · Status: approved (G2)

When a driver ends a delivery as "Customer not reachable", the Orders page had
no place to find it: its tabs were All, Awaiting confirmation, Awaiting rider,
In progress, On hold, Delivered and Cancelled, so a failed order showed only
under All and the tab counts did not add up.

## Decision

Option A on #273: one more tab on the Orders page, with a count.

- **Label: "Delivery failed"**, matching the status chip, the timeline entry
  and `hold/logic.ts`, so a status keeps one name across the admin app.
- **Position:** after "Delivered", before "Cancelled".
- **Count:** the same server count as the other tabs, from `total` of
  `GET /admin/orders?status=failed&limit=1`.
- **States:** the table's existing loading, error and empty states. Empty reads
  "No orders here yet."

## Out of scope

- A dashboard line or an admin notification for each failed delivery (option B).
  File it separately if the pilot dispatcher needs an alert and not just a
  place to look.
- Contact attempts on the timeline: done in #280.
- Rescheduling a failed order (R4, designed ahead). Cancel stays the only
  action.
