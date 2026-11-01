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
(technical lead), 2026-10-31 · Status: approved (G2)

**Approved (G2)** by @nnamdi-security (technical lead) on 2026-10-31, in two
decision comments on #293: the reason, the five cash wordings and the interim
record line first, then the hint, the record names and the 6-character id.
A third addition (#298), also approved by @nnamdi-security on 2026-10-31: a
driver row whose reason was removed when the driver was anonymized reads
"Removed on anonymization" in the Reason column.

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
| Riders panel, reason box (the same decision, #293) | A short hint under the box, which shows for a suspension and a reactivation (an approval has no reason box): "Do not include customer details." | Build now |
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
| Hint under the reason box | Do not include customer details. | Confirmed, @nnamdi-security, 2026-10-31 (#293) |
| Kinds of record | Driver, Order, Service area, Price list, Cash collection, Cash handover, Water source, Support request, Customer address, Account, Deletion request, Retention review | Confirmed as listed, @nnamdi-security, 2026-10-31 (#293) |
| Short id | The first 6 characters of the record's id | Confirmed, @nnamdi-security, 2026-10-31 (#293) |

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
5. **A removed reason says so (#298).** After a driver is anonymized, the four
   driver decision rows read "Removed on anonymization" in the Reason column
   instead of the staff's words, so a removed reason is not mistaken for "None".
6. **No other action gets a reason column value**, even if a later feature
   stores one in `details`, until it is added to the contract on purpose.

## Open questions

None.

## Known limitations

- **A short id does not say who.** Two rows about the same driver share an id,
  but a dispatcher still has to open the driver to see the name, until #296.

## Changes to the design system

None. The reason column, the second line and the hint reuse existing parts.
