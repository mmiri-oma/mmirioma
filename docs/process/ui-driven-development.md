# UI-driven development

How MmiriOma builds each feature: design the screens first, derive the API
contract from them, then build frontend and backend in parallel against that
contract.

**The rule:** screens decide *what data a page shows and which actions it
offers*. The SRS decides *business rules* (prices, statuses, permissions,
limits). A design never creates a rule. If a screen needs something the SRS does
not define, it goes back to the team as an open question.

## Roles

| Who | Does |
| --- | --- |
| Technical lead (or the agent working for them) | Writes the Claude Design prompt from the SRS and contracts; reviews designs against the SRS |
| Designers | Run the prompt in Claude Design, refine the result, record it in `docs/design/` |
| Frontend developers | Build the screens against the contract using mocks |
| Backend developers | Implement the contract |

## The workflow, per feature or milestone

### 1. Scope the slice

Open one GitHub issue naming the slice and its SRS requirement IDs and
acceptance tests, for example "Customer order request: FR-020, FR-021, FR-026,
FR-027, T-06".

Keep slices small and vertical (SRS §11). Follow the SRS order: ordering →
dispatch → driver → reconciliation.

### 2. Write the design prompt

Create `docs/design/prompts/<NN>-<slice>.md` from the existing prompts. Every
prompt must:

- describe the users and their devices (entry-level Android, slow networks);
- list every screen and **every state**: empty, loading, error, success, each
  domain error code (`too_many_attempts`, `quote_expired`, ...), and each status
  the user can see;
- give exact field rules and server messages from `docs/api/`;
- state the product's honesty rules (below);
- say which screens are **build now** and which are **design ahead** for later
  sprints;
- ask for output that maps onto the stack: React, Tailwind CSS v4 tokens,
  lucide icons.

Prompts start from [00-design-system.md](../design/prompts/00-design-system.md):
every later prompt must reuse that visual system, not invent a new one.

### 3. Generate and refine in Claude Design

The designer pastes the prompt into Claude Design, iterates on the result,
and records it in `docs/design/<slice>.md` using the
[template](../design/_template.md): link to the design, screen list, decisions
and the screen-to-endpoint table.

### 4. Review against the SRS

The technical lead checks the design before anyone builds it:

- every screen and state from the prompt exists;
- nothing contradicts the SRS (see the honesty rules below);
- sample data is visibly marked as sample;
- touch targets, contrast and labels meet NFR-020/NFR-021.

### 5. Derive the API contract

From the screen-to-endpoint table, create or update `docs/api/<area>.md` and its
mock JSON in `docs/api/examples/`. The frontend and backend owners both review
it. **Nothing is built until the contract is agreed.** If the design asks for a
field the SRS does not support, change the design, not the rules.

### 6. Build in parallel

- **Frontend:** typed functions in `frontend/src/lib/api/<area>.ts`, Zod
  validation where the data drives logic, screens built against mocks injected
  through `createApiClient({ fetch })`. Every designed state is implemented.
- **Backend:** models, service, router and tests returning exactly the
  contract's shapes and error codes.

### 7. Integrate and close

Swap mocks for the real API, run the slice end to end, and record an E2E or
documented manual test. Done means: design states, contract, frontend tests,
backend tests and `docs/features/<feature>.md` all match.

## Honesty rules every design must follow

From the PRD and SRS; designs that break them are rejected.

- **No invented prices.** Prices come only from the server (FR-022). Mockups
  may show sample naira amounts **labelled "Sample"**. In Sprint 1 there are no
  prices at all: orders are quote requests.
- **No false promises.** "Request received" or "awaiting confirmation" never
  looks like a confirmed delivery (FR-027). No "driver assigned" before the
  driver accepts (FR-032).
- **No live tracking.** No maps with moving vehicles or real-time ETAs (PRD §9,
  FR-037).
- **No water-quality claims.** Never "safe drinking water", "purified",
  "potable" or similar (PRD §3.2, FR-050).
- **No fake verification.** Phone verification is manual; never show "verified
  by SMS" (FR-003).
- **Simulated data is labelled** in staff views (BR-09).
- **Minimum customer data** in staff and driver views (PRD §4).

## Cadence

Design runs **one slice ahead** of building: while developers build slice N,
designers prepare slice N+1. Do not design the whole product up front.

## Prompt index

| Prompt | Slice | Status |
| --- | --- | --- |
| [00-design-system.md](../design/prompts/00-design-system.md) | Shared visual system (S1-04, S1-08) | Ready |
| [01-customer-ordering.md](../design/prompts/01-customer-ordering.md) | Customer sign-in and session states, order request, order history (S1-04) | Ready |
| [02-admin-orders.md](../design/prompts/02-admin-orders.md) | Admin sign-in and session states, order directory and detail (S1-08) | Ready |
| [03-driver-deliveries.md](../design/prompts/03-driver-deliveries.md) | Driver sign-in and session states, jobs, accept/decline (S1-07); pickup, proof, incidents (design ahead) | Ready; contract pending S1-06 |
