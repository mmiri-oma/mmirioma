# Admin audit log design (Settings page)

<!-- Workflow: docs/process/ui-driven-development.md. Fork gates: CLAUDE.md,
"Team workflow". -->

Issue: [#293](https://github.com/mmiri-oma/mmirioma/issues/293) ·
Requirements: NFR-004 · Contract:
[admin-operations.md](../api/admin-operations.md), `GET /admin/audit-logs`
(updated with this record, decided on #293) · Related:
[#296](https://github.com/mmiri-oma/mmirioma/issues/296) (the backend's
`target_label`), [#294](https://github.com/mmiri-oma/mmirioma/issues/294) (the
Riders reason box)
Designer: @Bonvee120 + Claude Code · Reviewed by: @nnamdi-security
(decision comment on #293), 2026-10-31 · Status: draft; G2 is given on #293 for
the reason and the five cash wordings, the rest is marked "to confirm" below

The audit log on the Settings page (`/admin/settings`) lists who did what and
when. A click-through on the real backend found three gaps (#293): the Reason
column never showed the reason the backend stores for driver decisions, four
cash actions showed as raw codes, and a row did not say which record it was
about. This record fixes the three on the existing table. It adds no control.

## Design link

No clickable preview: the change is a filled column, five words and a second
line in an existing table row. The states below specify each case. A preview can
be made from this record if the reviewer asks.

## Screens and states

| Screen | States designed | Build now / design ahead |
| --- | --- | --- |
| Settings, Audit log table | **A. A driver decision with a reason:** "Suspended a driver", and under "Reason" the staff's words, for example "Papers expired". **B. A driver decision with no reason** (an approval can have none): "None". **C. Every other row:** "None", as today (no other action stores a reason). **D. A cash action:** the five wordings below instead of the code. **E. The record:** a second, smaller line under the action: the kind of record in words and a short id, "Driver · 4f3a2c". **F. A kind or code with no words:** shown as the code itself, as an unknown action is today. **G. Loading, empty and error:** unchanged | Build now |
| Riders panel, reason box (the same decision, #293) | A short hint under the box, which shows for a suspension and a reactivation (an approval has no reason box): "Do not include customer details." | Build now (to confirm, see below) |
| Phone (360 px) | The same table with no column added; the second line stays under the action | Build now |

## Screen-to-endpoint table

All paths are under `/api/v1`.

| Screen | Element / action | Endpoint | Fields used |
| --- | --- | --- | --- |
| Audit log | Rows, newest first | `GET /admin/audit-logs` ([admin-operations.md](../api/admin-operations.md)) | `at`, `actor.name`, `action`, `target_type`, `target_id`, `details.reason` (only on the four driver actions) |

No row needs a change to the API. The contract's wording about reasons is
corrected in the same change (decision 1).

## Wording to approve

| Where | Wording | Status |
| --- | --- | --- |
| `cash_recorded` | Recorded a cash collection | G2 approved, @nnamdi-security, 2026-10-31 (#293) |
| `cash_handed_over` | Handed over cash | G2 approved, same |
| `cash_received` | Received cash | G2 approved, same |
| `cash_reconciled` | Reconciled cash | G2 approved, same |
| `cash_corrected` | Corrected a cash amount | G2 approved, same |
| Hint under the reason box | Do not include customer details. | His words on #293; **to confirm** that this is the final wording |
| Kinds of record | Driver, Order, Service area, Price list, Cash collection, Cash handover, Water source, Support request, Customer address, Account, Deletion request, Retention review | He named "Driver", "Order" and "Service area"; the other nine follow the same style and are **to confirm** |
| Short id | The first 6 characters of the record's id | He asked for "a short id" and did not say how long: 6 is the author's choice, **to confirm** |

`cash_remittance_recorded` ("Recorded a cash handover") stays: the backend still
writes it (`payments/service.py`).

## Decisions

1. **The reason shows for the four driver actions only** (`driver_approved`,
   `driver_suspended`, `driver_activated`, `driver_deactivated`). The audit row
   is the only place that reason is stored. It is a deliberate exception to the
   audit module's "ids and kinds only" rule; the exception is recorded in
   `backend/app/modules/audit/models.py` and `admin-operations.md`. Decided by
   @nnamdi-security on #293.
2. **Reasons stay staff notes.** They must not contain customer data, and the
   audit endpoint is admin-only. The hint under the reason box says so.
3. **The record is a second line, not a new column.** The table keeps its four
   columns, and the action and the record read together ("Suspended a driver"
   / "Driver · 4f3a2c").
4. **The short id is a stopgap.** When the backend sends a label (#296), the
   line shows it instead of the id.
5. **No other action gets a reason column value**, even if a later feature
   stores one in `details`, until it is added to the contract on purpose.

## Open questions

None for the design. The "to confirm" rows above are the author's proposals.

## Known limitations

- **Anonymizing a driver leaves the reason readable.** The privacy tool keeps
  audit rows (`privacy/service.py`), so a suspension reason stays on screen after
  the driver is anonymized. Blanking it is a backend change, tracked apart from
  #293.
- **A short id does not say who.** Two rows about the same driver share an id,
  but a dispatcher still has to open the driver to see the name, until #296.

## Changes to the design system

None. The reason column, the second line and the hint reuse existing parts.
