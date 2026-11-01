# Admin Water sources design

<!-- Workflow: docs/process/ui-driven-development.md. Fork gates: CLAUDE.md,
"Team workflow". -->

Issue: [#309](https://github.com/mmiri-oma/mmirioma/issues/309) ·
Requirements: FR-011, FR-012, FR-014, BR-09, BR-10, NFR-004 · Prompt:
[prompts/19-admin-water-sources.md](prompts/19-admin-water-sources.md) ·
Contract (agreed, G3): [admin-water-sources.md](../api/admin-water-sources.md)
Designer: @Bonvee120 + Claude Code (text design; no visual mockup yet) ·
Decisions: @nnamdi-security on #309, 2026-11-01 · Status: approved (G2, the written
design, @nnamdi-security, 2026-11-01); the visual mockup is still to be attached
and checked before the screen is built

This is a written design: the layout, every state and the exact wording. The
visual mockup is made from the prompt in Claude Design and attached before the
screen is built. The record becomes `Status: approved` when one reviewer who is
not the author checks it against the SRS and the issue's decisions (G2).

**Build note (2026-11-01).** The screen was built from this written design,
before the visual mockup, at the owner's request. The mockup is still to be
attached and checked; if it differs, the layout changes and the wording above
stays. The built screen follows this record state by state (see
`frontend/src/features/admin/pages/WaterSources.tsx`).

A new deployment has no water sources, and the only way to add one is a
command on the server. This screen lets an admin add a source, correct its name
and location, activate or renew it for a water category, and suspend or revoke
it. Each change writes the same audit row the command line does.

## Where it lives

A new item, **Water sources**, in the admin sidebar after "Pricing and
delivery", at `/admin/water-sources`. Admin role only. It uses the shared admin
frame and the visual system of [handoff-v1.md](handoff-v1.md), with the table
and dialog patterns of the Orders and Pricing pages. No new component is
needed beyond a list row that expands.

## The page

Header: the title "Water sources", one line under it ("Where water is collected,
and the categories each place is approved for."), and a primary button
**Add a source**.

One card per source, by name. A card shows:

- the name, the location under it, a chip for the kind (**Borehole**, **Ninth
  Mile**, or **Kind not set**) and a **SIMULATED** tag on a demo source (BR-09);
- an **Edit** button;
- one row per water category (Potable Water, Utility Water), always both:

| Column | Content |
| --- | --- |
| Category | The label, as stored |
| Status | A chip: **Activated**, **Suspended**, **Revoked**, or **Not activated** for a category the source has never had |
| Approved until | The date, e.g. "20 Nov 2026"; "None" when not activated |
| Expiry | The badge below, only on an Activated row |
| Report reference | The reference as typed, or "None" |
| Cost per litre | e.g. "₦1.50" for 150 kobo; "None" when not activated. Admin-only (decision 1) |
| Action | **Activate**, or **Renew**, **Suspend**, **Revoke** |

On a suspended or revoked row the reason shows under the status chip.

### The expiry badge (decision 4)

A badge on an Activated row, from the server's `expiry`:

| Server state | Badge |
| --- | --- |
| `expired` (`days_left` < 0) | **Expired**, red |
| `expires_soon` and `days_left` is 0 | **Expires today**, amber |
| `expires_soon` and `days_left` is 1 | **Expires in 1 day**, amber |
| `expires_soon` and 2 to 30 | **Expires in N days**, amber |
| `ok` | no badge |

The warning window is **30 days**, the technical lead's suggestion, fixed here.
The badge is the only warning: no notification and no banner. Colour is never
the only signal; the badge always has words.

A Suspended or Revoked row shows its status chip and no expiry badge.

## Dialogs

All dialogs use the shared dialog, close with Back or Escape, and keep the
buttons fixed at the bottom on a 360 px screen.

**Add a source.** Fields: Name (required, up to 120), Location (required, up to
200, with the hint "Where a driver collects the water, in words."), Kind
(Borehole or Ninth Mile or "Not set yet"). Buttons: Back, **Add source**.
Success toast: "Source added. Activate it for a category before it can serve an
order." (Both halves are true: a source with no activation is never eligible.)

**Edit a source.** The same three fields, filled in. Buttons: Back, **Save
changes**, disabled until something differs. Success toast: "Source updated."
A save that changes nothing closes without a toast.

**Activate or Renew.** The category is fixed by the row and named in the title:
"Activate for Utility Water" or "Renew for Utility Water". Fields:

- Report reference (required, up to 100);
- Approved until (a date, today or later);
- Cost per litre in naira, with two decimals (required, 0 or more). The screen
  converts it to whole kobo; it never rounds a fraction silently, and a third
  decimal is an error.

Under the form, in plain text, always visible (decision 2):

> MmiriOma records the report reference. The app does not check the laboratory
> report.

There is no "report checked" box and no control that reads as the approval
itself. Buttons: Back, **Activate** or **Renew**. Success toast: "Activated for
Utility Water." or "Renewed for Utility Water."

**Suspend or Revoke.** Title "Suspend for Utility Water" or "Revoke for Utility
Water". One required field, Reason (up to 500). Text above it: "From now on
this source cannot be chosen for new orders in this category. Orders already
confirmed with it keep it." Buttons: Back, **Suspend** or **Revoke** (danger
style). Success toast: "Suspended for Utility Water." or "Revoked for Utility
Water."

## States

| State | What the screen shows |
| --- | --- |
| Loading | The shared loading status in place of the cards |
| Empty | "No water sources yet." and under it "Add the first one, then activate it for a category. An order cannot be confirmed from a source that is not activated." The Add a source button stays |
| Error loading | "We couldn't load the water sources." with **Try again** |
| 403 | The shared "You can't open this page" state |
| Success | The list, with a toast after each change |
| Saving | The dialog's button shows its busy state and the fields are disabled |
| Form errors | Each field's message under it: "Enter a name.", "Enter a location.", "Enter the report reference.", "Choose a date from today.", "Enter the cost as naira, for example 1.50.", "Say why." |
| Server error in a dialog | A notice in the dialog: "We couldn't save this. Try again." The dialog stays open with the typed values |
| Source or category gone (404) | "This source has changed or been removed." with **Refresh**, which reloads the list |
| No connection | The shared "No connection" notice with **Try again** |

## Honesty rules

- No claim about the water. The words "safe", "clean", "tested", "certified",
  "approved water" and "quality" appear nowhere. A category is shown by its
  label only, and a status chip says what the record says ("Activated"), not
  what the water is.
- The report reference is shown as typed. No link, no document, no tick that
  suggests the app verified it (FR-012).
- No invented figures. In the mock, every price, date and reference carries the
  SAMPLE tag; a real figure comes only from the server.
- The cost per litre is shown to admins only. It never appears in a customer,
  driver or quote screen.
- A source flagged simulated shows SIMULATED (BR-09).

## Out of scope

- Editing a category's label or supported uses.
- A notification before an approval expires (decision 4).
- Deleting a source. Suspend and revoke keep the row, as the command line does.
- Any role other than admin (decision 5).

## Open questions

None for the design. The contract's three open questions are decided
([admin-water-sources.md](../api/admin-water-sources.md#open-questions)); the
form's error "Choose a date from today." follows decision 1 there.
