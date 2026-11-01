# Prompt 19: the admin Water sources screen

Issue: [#309](https://github.com/mmiri-oma/mmirioma/issues/309) ·
Requirements: FR-011, FR-012, FR-014, BR-09, BR-10, NFR-004 · Contract
(proposed):
[admin-water-sources.md](../../api/admin-water-sources.md) · Design record:
[admin-water-sources.md](../admin-water-sources.md) · Build: after G2 and G3.

**Why this prompt:** water may be collected only from a source approved for the
order's category (FR-012), and today the only way to add or change a source is a
command on the server. This screen gives an admin the same actions, with the
same audit rows.

**Before using:** the visual system is the **design handoff v1**
([handoff-v1.md](../handoff-v1.md)): the admin frame, the Orders page's table
and chips, and the dialogs of the hold review design. Add a component only when
a screen truly needs one, and say so. Paste everything inside the block into
Claude Design, or use it as the spec for a clickable preview.

```text
Using the MmiriOma admin design already in this project (design handoff v1:
the admin frame and sidebar, cards, chips, dialogs; Plus Jakarta Sans),
design the WATER SOURCES page at /admin/water-sources. Desktop first at
1280px; also 360px.

CONTEXT
An admin keeps the list of places water is collected. Each source can be
approved for the two water categories, Potable Water and Utility Water. An
order can only use a source that is activated for its category and whose
approval date has not passed.

PRODUCT HONESTY RULES (every screen)
- Say nothing about the water itself. Never use "safe", "clean", "tested",
  "certified", "approved water" or "quality". A category is its label only.
- The app does not verify the laboratory report. It stores a reference. There
  is no "report checked" box. Near the activation form, always visible, write:
  "MmiriOma records the report reference. The app does not check the
  laboratory report."
- No invented figures. Sample names, dates, references and prices carry a
  SAMPLE tag. A demo source carries a SIMULATED tag.
- The cost per litre is shown to admins only.

SCREENS AND STATES

W0. THE PAGE
  Title "Water sources", one line under it, and a primary button "Add a
  source". One card per source: name, location, a kind chip (Borehole, Ninth
  Mile, Kind not set), SIMULATED tag when it is a demo source, an Edit button.
  Inside the card, one row for each category, always both: Status chip
  (Activated, Suspended, Revoked, Not activated), Approved until, Expiry badge,
  Report reference, Cost per litre (for example "₦1.50"), and the actions:
  Activate when never activated; Renew, Suspend and Revoke otherwise. A
  suspended or revoked row shows its reason under the chip.

W1. EXPIRY BADGE (on an Activated row only)
  "Expired" (red), "Expires today", "Expires in 1 day", "Expires in N days"
  (amber, up to 30 days), nothing beyond 30. Words always, never colour alone.
  No notification and no banner.

W2. ADD / EDIT A SOURCE (dialog)
  Name (required), Location (required, hint "Where a driver collects the water,
  in words."), Kind (Borehole, Ninth Mile, Not set yet). Add: "Add source".
  Edit: "Save changes", disabled until something differs.

W3. ACTIVATE / RENEW (dialog)
  Title names the category. Report reference (required), Approved until (date,
  today or later), Cost per litre in naira with two decimals. The honesty line
  above sits under the form. Buttons Back and Activate or Renew.

W4. SUSPEND / REVOKE (dialog)
  Title names the category. A required Reason. Text: "From now on this source
  cannot be chosen for new orders in this category. Orders already confirmed
  with it keep it." Danger-style button.

STATES (every screen)
  Loading; Empty ("No water sources yet." with a line telling the admin to add
  one and activate it); error loading with "Try again"; 403; each field error;
  saving; a server error inside a dialog that keeps the typed values; "This
  source has changed or been removed." with Refresh; no connection. Success
  toasts: "Source added. Activate it for a category before it can serve an
  order.", "Source updated.", "Activated for <category>.", "Renewed for
  <category>.", "Suspended for <category>.", "Revoked for <category>."

PHONE (360px)
  Cards stack, category rows become small blocks, dialogs go full screen with
  the buttons fixed at the bottom.

OUT OF SCOPE
  Editing a category, deleting a source, notifications, other roles.
```
