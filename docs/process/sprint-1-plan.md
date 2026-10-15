# Sprint 1 plan (UI-first, contract-driven)

Status: **approved** (14 Oct 2026) · Milestone: Sprint 1 (due 18 Oct 2026, extended by 48 hours) ·
Method: [ui-driven-development.md](ui-driven-development.md)

Sprint 1 delivers the first vertical slice: a customer signs in, sends a water
request, and a dispatcher sees it. Every user-facing piece goes through:

```
Requirements → UI Design → Approval → API Contracts → Parallel Development → Integration → Testing
```

S1-01 to S1-12 are GitHub issues #2-#13 (restructured; #2 and #3 closed as
done in #14). S1-13 to S1-18 are issues #17-#22.

## Gates

| Gate | Passed when | Recorded in |
| --- | --- | --- |
| **G1 Requirements** | The slice issue lists its SRS requirement IDs and acceptance tests | GitHub issue |
| **G2 Design approved** | Claude Design result recorded with every screen and state, reviewed against the SRS, approved by the technical lead | `docs/design/<slice>.md`, `Status: approved` + approver + date |
| **G3 Contract agreed** | Endpoints, fields, error codes and mock JSON agreed by the frontend and backend owners | `docs/api/<area>.md`, `Status: agreed` + reviewers |

**Frontend rule:** no screen or UI component for a slice is built before that
slice has passed **G2 and G3**. Frontend PRs link both (PR template checkbox).
Non-visual frontend plumbing (typed API functions, session hook, route guard
logic) may start once G3 is passed, because it has no design.

**Backend rule:** business endpoints need G3. These may proceed without a
design (item 8 of the restructure):

- authentication (already implemented, contract exists);
- infrastructure: configuration, CI, migrations, error handling, rate limits;
- persistence derived directly from the SRS data model (SRS §5) and state
  machine (FR-033): models, migrations, constraints, idempotency, ownership
  rules. Response shapes are frozen only at G3.

## Responsibilities

| Person | GitHub | Owns |
| --- | --- | --- |
| Technical lead | nnamdi-security | Architecture, authentication (backend done; frontend session and sign-in screens), API contracts, design approvals (G2), integration lead |
| Chidinma | chidimmamogbo | Ordering backend; reviews order contracts |
| Amara | Cloudcrackamara | Customer UI design and build; design coordination: owns the Claude Design project and the shared design system; coordinates auth and driver designs |
| Chukwuebuka | Bonvee120 | Delivery workflow (state machine, assignment) and foundation (simulated demo data, local setup) |
| David | Daveoski | Administration UI design and build; contributes admin components to the design system |

## Dependency order

```
S1-13 design system ─┬─> S1-14 auth design ──(G2)──> S1-17 auth frontend ─────────────┐
                     ├─> S1-04 customer design ─(G2)─┐                               │
                     ├─> S1-08 admin design ───(G2)──┼─> S1-16 confirm contracts (G3) ─┼─> S1-05 customer UI ─┐
                     └─> S1-15 driver design ─(G2)─┐ │                     │          └─> S1-09 admin UI ────┤
                                                   │ │                     └─> S1-03 order endpoints ────────┤
S1-06 delivery state machine (starts now) ─────────┴─> S1-06 delivery contract (G3) ─> S1-07 assignment (P1) │
S1-03 order persistence (starts now) ─────────────────────────────────────────────────────────────────────────┤
S1-18 foundation (starts now)                                                                                 │
                                                                     S1-10 integration <──────────────────────┘
                                                                     S1-11 testing and demo <── everything
S1-12 pilot planning: independent, runs all sprint
```

## Issue plan

### S1-01 Agree shared auth/order/delivery API contracts (#2)

- **Assignee:** nnamdi-security · **Priority:** P0 · **Stage:** API Contracts
- **Description:** Auth and orders contracts are written and merged (#14).
  Under the new method they are inputs to design, then confirmed in S1-16.
- **Dependencies:** none.
- **Acceptance criteria:** auth and orders contracts in `docs/api/`; delivery
  part handed to S1-06.
- **Deliverables:** `docs/api/README.md`, `auth.md`, `orders.md`, examples
  (done). **Proposed action: close**, with the remaining confirmation tracked
  in S1-16.

### S1-02 Implement authentication and role authorization foundation (#3)

- **Assignee:** nnamdi-security · **Priority:** P0 · **Stage:** Parallel Development (backend, allowed before design)
- **Description:** Register/login/logout/me, cookie sessions, CSRF, role
  guards, rate limiting, staff CLI. Merged in #14.
- **Dependencies:** none.
- **Acceptance criteria:** met (tests and migration checks passed).
- **Deliverables:** `backend/app/modules/auth/`, migration `0002`,
  `docs/features/authentication.md`. **Proposed action: close.**

### S1-13 Shared design system in Claude Design (#17)

- **Assignee:** Cloudcrackamara (with Daveoski) · **Priority:** P0 · **Stage:** UI Design → Approval
- **Description:** Run prompt [00-design-system.md](../design/prompts/00-design-system.md)
  in the team's Claude Design project. Reconcile it with the tokens and
  components already proposed in PR #15 (`docs/design/ui-system.md`), so there
  is one system.
- **Dependencies:** none.
- **Acceptance criteria:** tokens (color, type, spacing, radius) and component
  states defined; AA contrast; touch-target size agreed (prompt says 48px,
  PR #15 uses 44px); approved by the technical lead.
- **Deliverables:** `docs/design/design-system.md` (approved); a token table
  ready for `frontend/src/index.css` `@theme`.

### S1-14 Authentication screens design (#18)

- **Assignee:** Cloudcrackamara (customer and driver screens; Daveoski for the
  staff screen) · **Priority:** P0 · **Stage:** UI Design → Approval
- **Description:** Run prompt [04-authentication.md](../design/prompts/04-authentication.md).
  The auth backend already exists, so the design must fit
  [auth.md](../api/auth.md).
- **Dependencies:** S1-13 approved.
- **Acceptance criteria:** all screens C1-C3, S1, D1, X1-X6 with every state;
  server messages exactly as in the contract; no OTP or reset flow; approved
  by the technical lead (G2).
- **Deliverables:** `docs/design/authentication.md` (approved) with the
  screen-to-endpoint table.

### S1-04 Design customer ordering flows (#5, restructured)

- **Assignee:** Cloudcrackamara · **Priority:** P0 · **Stage:** UI Design → Approval
- **Description:** Run prompt [01-customer-ordering.md](../design/prompts/01-customer-ordering.md):
  my orders, request water, request received, order detail; quote, delivery
  window and progress timeline as design ahead.
- **Dependencies:** S1-13 approved (auth screens come from S1-14).
- **Acceptance criteria:** every build-now screen and state, mobile and
  desktop; honesty rules met (no prices, "Request received" never shown as
  confirmed); sample data tagged; approved (G2).
- **Deliverables:** `docs/design/customer-ordering.md` (approved).

### S1-08 Design administration order screens (#9, restructured)

- **Assignee:** Daveoski · **Priority:** P0 · **Stage:** UI Design → Approval
- **Description:** Run prompt [02-admin-orders.md](../design/prompts/02-admin-orders.md):
  layout, order directory with filters, order detail. Order history is
  deferred to the dispatch work. The screens already built in PR #15 may be
  used as input, but the approved design is the reference.
- **Dependencies:** S1-13 approved.
- **Acceptance criteria:** every build-now screen and state, desktop and
  mobile; "Simulated" tag and data-minimization rules met; approved (G2).
- **Deliverables:** `docs/design/admin-orders.md` (approved).

### S1-15 Delivery-partner (driver) mobile design (#19)

- **Assignee:** Cloudcrackamara (design coordination) with Bonvee120
  (workflow input) · **Priority:** P1 · **Stage:** UI Design → Approval
- **Description:** Run prompt [03-driver-deliveries.md](../design/prompts/03-driver-deliveries.md).
  Sprint 1 needs only the job list and accept/decline (for S1-07); the rest is
  design ahead. Proof of delivery is designed as two options for the team to
  decide (SRS §12.7).
- **Dependencies:** S1-13 approved.
- **Acceptance criteria:** build-next screens with all states at 360px; no
  tracking; "delivered" unreachable without quantity and acknowledgement;
  approved (G2).
- **Deliverables:** `docs/design/driver-deliveries.md` (approved).

### S1-16 Confirm order contracts against approved designs (#20)

- **Assignee:** nnamdi-security (reviewers: chidimmamogbo, Cloudcrackamara,
  Daveoski) · **Priority:** P0 · **Stage:** API Contracts
- **Description:** Walk the screen-to-endpoint tables of S1-04 and S1-08
  against `docs/api/orders.md`. Change the contract only where a screen needs
  something the SRS allows; anything else becomes an open question. Mark the
  contract agreed.
- **Dependencies:** S1-04 and S1-08 approved.
- **Acceptance criteria:** every build-now screen element maps to a contract
  field; mock JSON updated; `Status: agreed` with reviewer names (G3).
- **Deliverables:** updated `docs/api/orders.md` and `docs/api/examples/`.

### S1-03 Order models and order APIs (#4, restructured)

- **Assignee:** chidimmamogbo · **Priority:** P0 · **Stage:** Parallel Development (backend)
- **Description:** Two parts.
  1. **Starts now:** order model, statuses (FR-033), migration, idempotency
     constraint (FR-026), non-guessable reference (FR-027), ownership rules
     (FR-001), using `CurrentCustomer`/`CurrentAdmin` from the auth module.
  2. **After S1-16:** `POST /orders`, `GET /orders`, `GET /orders/{reference}`,
     `GET /admin/orders`, `GET /admin/orders/{reference}` exactly as agreed.
- **Dependencies:** part 1 none; part 2 S1-16.
- **Acceptance criteria:** T-06 (duplicate checkout) and T-07 (cross-customer
  access) automated; migrations reviewed and tested up/down/check; no prices.
- **Deliverables:** `backend/app/modules/orders/`, migration,
  `docs/features/orders.md`, tests.

### S1-06 Delivery state machine and assignment contract (#7, restructured)

- **Assignee:** Bonvee120 · **Priority:** P0 · **Stage:** Requirements → API Contracts
- **Description:** Two parts.
  1. **Starts now:** delivery and assignment states and transition table
     (assignment, acceptance, pickup, transit, completion, failure,
     reassignment), aligned with the order statuses in `orders.md` (FR-031 to
     FR-036). This is SRS-driven and needs no design.
  2. **After S1-15:** driver endpoints derived from the driver design.
- **Dependencies:** part 1 none; part 2 S1-15.
- **Acceptance criteria:** state table with permissions and exceptional paths
  reviewed by the technical lead and Chidinma; contract agreed (G3).
- **Deliverables:** `docs/api/deliveries.md` and mock JSON.

### S1-07 Initial driver assignment backend (#8)

- **Assignee:** Bonvee120 · **Priority:** P1 · **Stage:** Parallel Development (backend)
- **Description:** Admin assigns a confirmed order; driver accepts or
  declines. Built against the S1-06 contract.
- **Dependencies:** S1-06 contract agreed; S1-03 part 1.
- **Acceptance criteria:** permission and capacity checks; idempotent
  transitions; tests for unauthorized and invalid transitions (T-07, FR-033).
- **Deliverables:** assignment module, migration, feature doc, tests.

### S1-18 Delivery and demo foundation (#22)

- **Assignee:** Bonvee120 · **Priority:** P1 · **Stage:** Parallel Development (backend infrastructure)
- **Description:** Tooling the vertical slice needs: a seed command that
  creates **simulated** staff, driver and customer accounts and orders, all
  flagged `is_simulated` (BR-09, NFR-031); keep local setup steps in the
  README working for the team.
- **Dependencies:** accounts part none (auth CLI exists); orders part S1-03
  part 1.
- **Acceptance criteria:** one command seeds a demo dataset that can never be
  mistaken for real pilot data; documented; tests for the simulated flag.
- **Deliverables:** seed command, README section, tests.

### S1-17 Authentication frontend (#21)

- **Assignee:** nnamdi-security · **Priority:** P0 · **Stage:** Parallel Development (frontend)
- **Description:** Session handling (`getMe` on load, CSRF token, route
  guards per role) and the approved sign-in, registration and session screens
  for the customer and staff apps. Driver screens follow with S1-15.
- **Dependencies:** plumbing: none (contract exists). Screens: S1-14
  approved (G2).
- **Acceptance criteria:** every designed state implemented; Vitest tests for
  guards and error states; no secret in storage (CSRF in memory only).
- **Deliverables:** `frontend/src/features/auth/`, tests, update
  `docs/features/authentication.md`.

### S1-05 Build customer ordering UI (#6, restructured)

- **Assignee:** Cloudcrackamara · **Priority:** P0 · **Stage:** Parallel Development (frontend)
- **Description:** Build the approved customer screens against mocks of the
  agreed contract, inside the auth shell from S1-17.
- **Dependencies:** S1-04 approved (G2), S1-16 agreed (G3), S1-17 session
  plumbing.
- **Acceptance criteria:** every designed state; validation matching the
  contract; double-submit prevented (NFR-022); component tests.
- **Deliverables:** `frontend/src/features/customer-orders/`,
  `frontend/src/lib/api/orders.ts`, tests.

### S1-09 Build administration order directory (#10, restructured)

- **Assignee:** Daveoski · **Priority:** P1 · **Stage:** Parallel Development (frontend)
- **Description:** PR #15 already implements this against mocks. Align it
  with the approved admin design and the agreed contract, then merge.
- **Dependencies:** S1-08 approved (G2) and S1-16 agreed (G3).
- **Acceptance criteria:** matches the approved design; every state; uses the
  approved design system; component tests.
- **Deliverables:** PR #15 updated and merged.

### S1-10 First customer-to-admin vertical slice (#11)

- **Assignee:** nnamdi-security, chidimmamogbo · **Priority:** P0 · **Stage:** Integration
- **Description:** Swap mocks for the real API: customer signs in, sends a
  request, dispatcher sees it.
- **Dependencies:** S1-03 part 2, S1-05, S1-09, S1-17.
- **Acceptance criteria:** the flow works end to end without database edits;
  an E2E or documented manual test is recorded.
- **Deliverables:** integration PR, test record in the feature docs.

### S1-11 Sprint testing, quality check and demo (#12)

- **Assignee:** whole team · **Priority:** P0 · **Stage:** Testing
- **Description:** Each author validates their area, runs the full checks,
  updates feature docs and `LOG.md`; the team rehearses the demo.
- **Dependencies:** S1-10.
- **Acceptance criteria:** all checks pass in CI; demo script succeeds;
  simulated data labelled; known gaps listed.
- **Deliverables:** demo script, known-gaps list.

### S1-12 Plan live water delivery pilot dependencies (#13)

- **Assignee:** nnamdi-security, Bonvee120 · **Priority:** P0 · **Stage:** independent (not software)
- **Description, criteria, deliverables:** unchanged from the issue.

## Timeline

Sprint 1 was extended by 48 hours on 14 Oct 2026: the milestone is now due
**18 Oct 2026** (GitHub stores the date only; the cutoff is 10:48 WAT, 48 hours
after the original). Design, approval and contract confirmation finish first,
then the frontend builds:

| When | Work |
| --- | --- |
| 14 Oct | S1-13; then S1-14, S1-04, S1-08, S1-15 in Claude Design. Backend: S1-03 part 1, S1-06 part 1, S1-18 |
| 15 Oct (midday) | Approvals (G2) and S1-16 (G3). Then S1-17, S1-05, S1-09, S1-03 part 2, S1-06 part 2 |
| 16-17 Oct | Frontend builds (S1-17, S1-05, S1-09); backend endpoints (S1-03 part 2, S1-07) |
| 18 Oct | S1-10 integration, S1-11 testing and demo |

If approvals slip past 15 Oct, move S1-05, S1-09 and S1-10 to Sprint 2 rather
than starting screens before their gates.
