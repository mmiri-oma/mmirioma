---
name: mmirioma-engineering
description: MmiriOma engineering standards and workflow. Use when implementing, changing, documenting, testing, or reviewing any MmiriOma backend (FastAPI, SQLAlchemy 2, Pydantic v2, Alembic, PostgreSQL/PostGIS) or frontend (React, TypeScript, Vite, Tailwind) code, including new features, bug fixes, endpoints, models, migrations, and code review.
when_to_use: Before writing or reviewing code in this repository, or when asked to implement, add, fix, migrate, document, or review anything in MmiriOma.
argument-hint: "[task description | review]"
---

# MmiriOma engineering

Use this workflow for every implementation or review task in this repository.
Authority order: **SRS > PRD > CLAUDE.md > this skill**. If they conflict, follow the
higher one and tell the user about the conflict.

Task: $ARGUMENTS

## 1. Understand the requirement first

1. Read `CLAUDE.md` and `LOG.md` (known issues and their fixes). Read `docs/architecture/backend.md` and/or `docs/architecture/frontend.md` for the area you will touch.
2. Read the requirement sources at the repo root: `MmiriOma_MVP_SRS.md` (normative) and `MmiriOma_MVP_PRD.md`. Use [references/requirements.md](references/requirements.md) to find the relevant sections, then read them in the source files.
3. Identify the requirement IDs the task implements (`FR-`, `BR-`, `NFR-`, `PR-`) and the acceptance tests (`T-01`…`T-14`).
4. Check the open decisions (PRD §13, SRS §12). If the task depends on an unresolved one, or the documents do not answer a business question, **stop and ask the user**. Never invent business rules, prices, limits, or state names.
5. Read the existing module code and `docs/features/<feature>.md` if present. Reuse existing patterns (`APIError`, `get_db_session`, `Base` + mixins, `apiClient`).
6. For review tasks: get the diff (`git diff`, `git diff main...HEAD`, or the named files), then go to step 6.

## 2. Verify framework usage against installed versions

For any version-dependent, security-sensitive, or unfamiliar API:

1. Run `bash "${CLAUDE_SKILL_DIR}/scripts/versions.sh"` to get installed versions.
2. Consult the official docs for those versions (links in [references/backend.md](references/backend.md) and [references/frontend.md](references/frontend.md)).
3. Use the supported, non-deprecated approach. Never upgrade dependencies as a side effect.
4. In the final report, list the docs you actually checked. If docs were unreachable, say so. **Never claim verification that did not happen.**

## 3. Implement

- Follow [references/backend.md](references/backend.md) and [references/frontend.md](references/frontend.md).
- One module per domain under `backend/app/modules/` (pricing, orders, dispatch, payments, reporting... per NFR-034). Business logic in services, not routers or components.
- Money is integer **kobo** (SRS §5). Never floats.
- All state transitions are validated server-side by role and prior state (FR-033) and recorded as events/audit logs (NFR-004).
- Schema changes go only through reviewed Alembic migrations.
- Do not add dependencies, frameworks, or infrastructure without explicit approval.
- Do not change existing API contracts silently.
- No fake integrations, fabricated prices or routes, or simulated data presented as real (SRS §12, BR-09). Build a transparent manual fallback instead.
- Stay in scope: no unrelated refactors, no placeholder features that look operational.

## 4. Document

Follow [references/documentation.md](references/documentation.md):

- Google-style docstrings (Python) and TSDoc (TypeScript) on public and exported code.
- Comments explain *why* and cite requirement IDs for business rules (pricing, authorization, payments, state transitions).
- Create or update `docs/features/<feature>.md` (10-section template) for every significant feature that now **exists**. Update `docs/architecture/` if cross-cutting behavior changed.
- Update docs in the same change as the behavior. Remove anything outdated.

## 5. Test

- Follow [references/testing.md](references/testing.md). Every new behavior gets tests, including the SRS acceptance tests it covers, and every bug fix gets a regression test.
- Run `bash "${CLAUDE_SKILL_DIR}/scripts/check.sh"`. Add `--db` to include `alembic check` and integration tests against the local Docker database.
- Fix failures. Never skip, delete, or weaken tests to get them passing. Report the real output.

## 6. Review

Apply [references/review-checklist.md](references/review-checklist.md) to your own diff before reporting. For review requests, report findings ranked by severity, each with `file:line`, a concrete failure scenario, and a suggested fix.

## 7. Report

Add an entry to `LOG.md` for every issue or error encountered during the task (rules in `CLAUDE.md`, "Issue log").

Summarize: files changed, requirement IDs covered, decisions and why, docs consulted, check results, new `LOG.md` entries, and open questions or concerns.

Never commit, push, merge, rebase, or switch branches unless the user explicitly asks.
