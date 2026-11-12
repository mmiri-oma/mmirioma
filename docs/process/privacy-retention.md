# Privacy requests and data retention (staff procedure)

Issue: #104 · Requirements: NFR-005, NFR-003, NFR-004, FR-055 · Pilot
condition: G7 · Owner: technical lead (@nnamdi-security), who is also the
privacy contact and the legal operator named in the notice · Decided:
technical lead, 2026-10-23 (main repo), extended for the fork 2026-10-27

Copied from the main repo's
[docs/process/privacy-retention.md](https://github.com/mmiri-oma/mmirioma-original/blob/main/docs/process/privacy-retention.md)
(commit `c4d972c`), then brought up to date with what the fork's privacy
tool does: deletion requests made in the app, and the customer data added
since (saved addresses, in-app messages, support requests, order feedback).
Issue numbers below are this fork's unless a link says otherwise.

How staff carry out what [PRIVACY_NOTICE.md](../../PRIVACY_NOTICE.md)
promises: answering access, correction and deletion requests (notice
section 9), and keeping data no longer than its retention table (section 8).
Automatic deletion is deferred for the pilot, so every step here is done by
a person. If the notice and this procedure disagree, fix whichever is wrong
in the same change; the notice must never promise something staff do not do.

## Who does what

| Who | Does |
| --- | --- |
| Privacy contact (technical lead) | Owns this procedure and the request register; checks identity; runs the command-line tools; records the outcome of deletion requests made in the app; signs off the monthly review |
| Administrator | Takes requests on the support line; resolves customers' support requests in the admin app; checks the requester's orders in the admin screens; deletes support-line messages |
| Anyone on the team | Passes a privacy request they receive to the privacy contact the same day |

## The request register

One private spreadsheet kept by the privacy contact, **never** in the
repository, `docs/log/`, GitHub issues or chat. One row per request:

- request date, channel (call, SMS, WhatsApp, email, or the app's
  "Delete my account" with its `DR-` reference) and type (access,
  correction, deletion, other);
- the account's ID (from the database, not the phone number or name);
- date acknowledged, date identity confirmed, date completed;
- what was done, and which records were kept and why (section 10 of the
  notice);
- who did it.

It also holds one row per monthly review (below) and per backup restore.
The register is itself personal data: keep it 3 years after the request is
completed, like complaints.

## Handling a request

**Deadlines (notice section 9):** acknowledge within **3 working days**;
complete a straightforward request within **14 calendar days**. For a
request made in the app, the app shows the customer an acknowledge-by date
(3 working days, Monday to Friday) and the request's status.

1. **Record it** in the register the day it arrives.
2. **Acknowledge** to the requester: say what will happen and by when. For a
   deletion request made in the app, also record the acknowledgement so the
   customer sees it:

   ```bash
   python -m app.modules.privacy.cli set-deletion-status --by <your admin phone> \
       --request <DR- reference> --status acknowledged
   ```

3. **Confirm identity.** Call back the phone number on the account from the
   support line; the person must answer on that number. A request by email
   alone is not enough, and neither is a request in the app on its own (a
   signed-in phone may not be in its owner's hands). Never read out or send
   account details before this step.
4. **Do the request** (below), then tell the requester the outcome on the
   confirmed number, and record it.

### Access

Give the requester what section 2 of the notice lists for their account:
name and phone, saved addresses and their map locations, each order's delivery details and map location, status
history, agreed price and window, delivery record and cash record, their
feedback, their support requests and their in-app messages. Read it from
the admin screens or with a read-only database query; never change data to
answer an access request. Send a written summary only to the confirmed
number, or by email to an address the requester confirms on that call.

### Correction

- **Phone number:** the customer changes it themselves in the app ("Change
  phone number", FR-004); it needs an SMS code to the new number.
- **Name:** `python -m app.modules.privacy.cli correct-name --by <your admin
  phone> --customer <customer phone> --name "<corrected name>"` (see
  "Tooling" below).
- **Saved addresses:** the customer can remove one in the app. Adding and
  editing addresses in the app wait for the area picker (#79); until then a
  wrong saved address is removed, not corrected.
- **A past order's details** are a record of what happened and are not
  rewritten. If they are wrong, add a note to the register and, if it
  matters for a dispute, to the order's incident record.

### Deletion

1. **Close access now.** Deactivate the account; this also signs it out
   everywhere:

   ```bash
   # from backend/, with the production environment loaded
   python -m app.modules.auth.cli deactivate --phone <phone>
   ```

2. **Check what must stay** with a dry run, which changes nothing:

   ```bash
   python -m app.modules.privacy.cli anonymize-customer --by <your admin phone> --customer <phone>
   ```

   It refuses, listing each order, while an order is not finished (only
   `delivered` and `cancelled` are: cancel a `failed` order that will not
   be rescheduled first), has an open hold or review, or has cash not
   settled in the app (cash with the driver, received but not reconciled,
   or a delivered order with no cash recorded). Its `Check:` lines list
   part payments (balance collected outside the app, F9) and overpayments
   (refund outside the app, F7): look at those records, and at any open
   refund, before going on. Read the count of staff notes kept on the
   orders and check them for personal details.

   If anything must stay open, tell the requester which orders and that
   deletion follows once they are closed; record it. Do not cancel a live
   order to delete an account unless the requester asks for the
   cancellation. For a request made in the app that cannot go ahead at all
   (for example an unresolved dispute), record it as refused with the
   reason. The app shows the customer only the status, not the reason, so
   tell them the reason on the confirmed number:

   ```bash
   python -m app.modules.privacy.cli set-deletion-status --by <your admin phone> \
       --request <DR- reference> --status refused --reason "<why, 5-500 characters>"
   ```

3. **Anonymize:** run the same command with `--apply`. Record the account
   id and the counts it prints in the register. What it keeps and removes:

   | Kept | Removed or anonymized |
   | --- | --- |
   | Cash payment and refund records with their amounts and dates (6 years, notice section 8) | Account name and phone number; the account is closed and can no longer sign in |
   | Order reference, quantities, statuses, times, source and price (for accounting and safety records) | Each order's contact name and phone, delivery address, landmark and instructions |
   | Order feedback ratings and answers (they no longer identify the customer) | The feedback message |
   | Support request records: type, order, status and dates | The customer's message and the staff's resolution note on each support request (both replaced by "Removed at the customer's request.", #117) |
   | Deletion request records: reference, dates and outcome | The reason the customer gave |
   | Records under a documented exception (notice section 10), with the reason in the register | Saved addresses, in-app messages, phone verification codes, sessions, driver GPS points for those orders |

4. **Record the outcome of a request made in the app** once step 3 has run;
   the tool accepts `completed` only after the account is anonymized:

   ```bash
   python -m app.modules.privacy.cli set-deletion-status --by <your admin phone> \
       --request <DR- reference> --status completed
   ```

5. **Support line:** delete the requester's messages on the support phone
   (SMS, WhatsApp) unless an exception applies.
6. **Confirm** the outcome to the requester on the confirmed number and
   record it. The app does not send it.

### Deletion: website contact messages

A person who sent a message through the website contact form has no account
and no "Delete my account" button (notice section 9). They ask by the support
line or the privacy email; confirm identity by call-back to the number they
gave, as above, and ask which number they wrote from (#364).

1. **Check what would go** with a dry run, which changes nothing:

   ```bash
   python -m app.modules.privacy.cli delete-website-messages --by <your admin phone> --phone <phone>
   ```

   It prints how many messages were sent from that number and how many staff
   had not resolved yet. If some are unresolved, check the admin Support queue
   first: the requester may want an answer before the message goes. It refuses,
   with no change, when no website message was sent from the number.
2. **Delete:** run the same command with `--apply`. It deletes each message whole
   (name, phone and message) and writes one audit row per message with its id
   and status only. Record the counts in the register.
3. **If they are also a customer,** the account steps above do not touch
   website messages (the form never links a message to an account): run this
   command too, and `anonymize-customer` if they asked for the account.
4. **Confirm** the outcome on the confirmed number and record it. The 3-year
   review deletes resolved website messages by itself.

### Deletion: riders and drivers

Current dispatch location (#410) is separate from delivery-evidence GPS. Only the
latest point is stored. Withdrawal, going offline, removal of approval, account
deactivation and anonymization delete it and invalidate its sharing grant under
the driver-profile lock. No monthly retention delay applies. The anonymization
report and audit include `location_points_cleared`; never coordinates.

A rider or driver asks by the support line or the privacy email (the
partner app has no "Delete my account"); confirm identity by call-back as
above. Rules confirmed by the privacy contact on #119 (2026-10-27).

1. **Close access now:** `python -m app.modules.auth.cli deactivate --phone <phone>`.
2. **Check what must stay** with a dry run, which changes nothing:

   ```bash
   python -m app.modules.privacy.cli anonymize-partner --by <your admin phone> --partner <phone>
   ```

   It refuses, listing each order, while they have a live job (offered or
   accepted), cash not reconciled (`collected`, `awaiting_remittance`,
   `remitted`: settle it while the account still identifies who owes it,
   FR-041), or an open hold or review, or a dispute, on a job they accepted.
   Read the count of incident and pickup notes they wrote and check them for
   personal details.
3. **Anonymize:** run the same command with `--apply`, and record the
   account id and the counts it prints in the register.

   | Kept | Removed or anonymized |
   | --- | --- |
   | Assignments (who did which job), pickup records, delivery attempts and proofs (without GPS), incidents and their notes | Name ("Former rider or driver") and phone; the account is closed and its sessions end |
   | Cash collections and remittances (6 years, notice section 8) | Plate, declared capacity and availability; alert and SMS switches and transfer methods reset; service zones |
   | The approval status, as a historical record; audit rows | Their own words on declines (replaced by "Removed at the partner's request.") and in-app messages |
   | GPS points on disputed orders or orders with an open matter (evidence, notice section 8) | Every other GPS point they recorded |

4. **Confirm** the outcome on the confirmed number and record it.

## Monthly retention review

On the first working day of each month the privacy contact works through
the notice's retention table and records the review in the register (date,
what was deleted, what was kept and why). Each line is due when its period
in section 8 has passed:

| Notice row | What to do (tool: `retention-review`; the rest by hand) |
| --- | --- |
| Phone verification codes, delivery codes | Tool: blank the scrambled code of every expired code; the rows stay as the record of the verification, phone change (NFR-004) or confirmed delivery (technical lead, 2026-10-23) |
| Accounts never verified | Tool: customer accounts with no verified phone, created more than 30 days ago and without orders, are deleted with their saved addresses and requests. One that audit rows name as the actor (a password or address change) is anonymized and closed instead, so the audit record stays (technical lead, 2026-10-27, #82). The notice says so since version 2.0: wording accepted by the privacy contact on PR #106 (2026-10-27) |
| Saved addresses (with any map location), in-app messages | Nothing monthly: they are removed when the account is closed (Deletion, step 3) |
| Order and delivery records | Tool: anonymize orders completed more than 3 years ago, as in "Deletion" step 3; their map locations are cleared and their feedback messages are blanked too (#340) |
| Feedback on an order | Goes with the order (above) |
| Driver GPS points | Tool: clear GPS points recorded more than 90 days ago, unless an open complaint or dispute needs them |
| Cash payment and refund records | Nothing to do until the first records reach 6 years; before then, confirm the accounting period (open item 3) |
| Complaints, disputes and incidents | Tool: the order's personal details go with the order at 3 years. By hand: staff notes are kept, so check notes on incidents resolved more than 3 years ago for personal details |
| Problems you report in the app | Tool: support requests resolved more than 3 years ago are deleted (technical lead, 2026-10-27, #82). Open ones are kept until resolved |
| Messages sent through the website contact form | Tool: deleted with the support requests resolved more than 3 years ago (they are support requests with no account, #339). Open ones are kept until resolved. They have no account, so the account-based steps never reach them: a visitor who asks to delete one is found by the phone number they gave and handled by hand until the privacy tool can look up a request by phone (follow-up issue, before the form goes live) |
| Map location kept on a price quote | Tool: `anonymize-customer` clears it on the customer's quotes; the monthly review clears it on a quote when its order is anonymized (3 years after the order finishes) and on a quote that never became an order 90 days after its price expired (technical lead, 2026-11-03, #385). The price, the distance and the rates stay. Output line "Quote map pins cleared" |
| Account deletion requests | Tool: requests completed or refused more than 3 years ago are deleted (privacy contact, 2026-10-27, #118). Requests still received or acknowledged are open work and are never deleted |
| Support line messages (by hand) | Delete messages on the support phone 12 months after the matter was resolved |
| Sign-in sessions | Tool: delete expired or ended sessions |
| Server logs (by hand) | Check that log rotation keeps at most 90 days |
| Encrypted backups (by hand) | Check that backups older than 30 days are gone |
| Request register (by hand) | Delete rows completed more than 3 years ago |

The database rows are done by the tool. Run it without `--apply` first: it
reports what is due and changes nothing. Then run it with `--apply` and copy
its counts into the register. It prints the steps left to do by hand:

```bash
python -m app.modules.privacy.cli retention-review --by <your admin phone>
python -m app.modules.privacy.cli retention-review --by <your admin phone> --apply
```

## Backups

Backups expire within 30 days (see
[the Hostinger deployment runbook](../deployment/hostinger.md#backups)). If a backup is ever restored,
before the service is used again re-apply every deletion and anonymization
recorded in the register since that backup was taken, and record the
restore in the register (notice section 10).

## Tooling

Deactivation is `app.modules.auth.cli deactivate`. Anonymizing a customer
or (with `anonymize-partner`) a rider or driver,
deleting a website contact message by phone (`delete-website-messages`, #364),
correcting a name, recording the outcome of a deletion request made in the
app (`set-deletion-status`) and the monthly database steps are
`app.modules.privacy.cli` (how it works:
[docs/features/privacy-tool.md](../features/privacy-tool.md)). Run it from
`backend/` with the virtualenv active and `DATABASE_URL` set to the
database you mean: check it first, because without it the tool reads the
repository's `.env`. Customer records are protected by foreign keys, so never
edit them with hand-written SQL in production. Every command names your
admin account and writes an audit row.

## Open items before the pilot

1. **Review by a Nigerian legal or data-protection adviser**, where
   practicable (NFR-005). Not done as of 2026-10-27. The technical lead
   records here whether it was done, or why it was not practicable.
2. **Hosting provider:** updated in version 3.0 (#319). The service runs
   with Hostinger (HOSTINGER Global S.à r.l., Luxembourg) in Paris, France,
   and off-site backup copies go to Backblaze (Backblaze, Inc., United
   States) in Amsterdam, the Netherlands. Data leaves Nigeria for two
   providers, one of them a US company, so check the cross-border safeguards
   in the legal review (item 1). The notice calls backups "encrypted": the
   Backblaze bucket needs server-side encryption on, and the local copies on
   the server are plain dump files (`docs/deployment/hostinger.md`,
   section 10).
3. **Accounting retention:** confirm the 6-year period against the legal
   operator's status and Nigerian accounting and tax law.
4. **Rider and driver deletion:** done: `anonymize-partner` (#119; "Deletion:
   riders and drivers").

## Changing the notice

1. Edit `PRIVACY_NOTICE.md`: raise the version (2.0 to 2.1 for a
   clarification, a new major version when what is collected or shared changes) and set the
   "Last updated" date.
2. Make the same change on the website's Privacy page,
   `frontend/src/features/marketing/LegalPages.tsx` (`/privacy`). In the
   fork it is a hand-made copy of the notice, section by section (PR #106),
   not a page rendered from the file, so both change together;
   `privacyNotice.test.tsx` checks the headings and the version.
3. Update this procedure if staff practice changes.
4. If the change affects customers (new data or a new recipient), tell
   them before it takes effect where possible (notice section 15).

## Changes

| Date | Change | By |
| --- | --- | --- |
| 2026-11-03 | Notice 7.0 (#332): adds the record of the acceptance at sign-up. Anonymizing an account also clears that record | @chidimmamogbo (+ Claude Code) |
| 2026-11-03 | "Deletion: website contact messages" with `delete-website-messages` (#364): a visitor with no account is found by phone number and their messages are deleted whole, with one audit row each. No change to the notice (section 9 already says to call or email) | @nnamdi-security (+ Claude Code), #364 |
| 2026-11-03 | Notice 6.0 (#340): a map location of the delivery address is collected, only if the customer chooses "Use my location" or places a pin (section 2); section 5 says the app asks for the phone's location only on that choice and never to track; the assigned driver sees the pin (section 7); saved-address locations are kept with the address and an order's location follows the order's 3 years (section 8). `anonymize-customer` and the review clear order locations. Wording for the notice's legal operator to review | @nnamdi-security (technical lead, decision on #340 and `docs/architecture/maps.md`) + Claude Code, #340 |
| 2026-11-03 | Notice 8.0 (#385): the price we calculate, and the map location kept with it, are collected (section 2) and kept as the retention table says (section 8); the tool clears the location (above). Wording for the notice's legal operator to review | @nnamdi-security (technical lead and privacy contact, condition on the #385 contract) + Claude Code, #385 |
| 2026-11-03 | Notice 5.0 (#346): section 7 names OpenFreeMap, the map-tile provider of the landing page's service-area map (the visitor's IP address and the map tiles viewed, not any typed address), as agreed in #334 and the #346 review. Wording for the notice's legal operator to review | @nnamdi-security (technical lead, #346 review) + Claude Code, #346 |
| 2026-11-02 | Notice 4.0 (#339): messages sent through the website contact form are collected (section 2), seen by staff (section 7), kept 3 years after resolution (section 8) and found by phone number on request (section 9); the retention table row above. Wording for the notice's legal operator to review | @nnamdi-security (technical lead, answer on the #339 contract) + Claude Code, #339 |
| 2026-10-27 | "Deletion: riders and drivers" with `anonymize-partner`, by the rules the privacy contact confirmed on #119; open item 4 closed | @nnamdi-security (+ Claude Code), #119 |
| 2026-10-27 | Copied into the fork from the main repo (`c4d972c`) and extended: deletion requests made in the app (`set-deletion-status`), what anonymizing also removes (saved addresses, in-app messages, support request messages, the deletion reason, feedback messages), never-verified accounts with audit rows anonymized, support requests in the monthly review, rider and driver accounts (open item 4), and the website copy of the notice. The notice question in #104 (section 8, never-verified accounts) is decided: the wording from PR #106, accepted by the privacy contact. Privacy contact's decisions (2026-10-27): the notice becomes 2.0, as the version rule asks when what is collected changes (it had been numbered 1.2 and was never published); section 9 names "Delete my account" in the app; rider and driver deletion gets its own issue (#119) | @nnamdi-security (+ Claude Code), #104 |
