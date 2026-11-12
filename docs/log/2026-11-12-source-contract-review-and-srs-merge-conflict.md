# 2026-11-12: Supplier contract review and SRS merge conflict

- **Area:** process
- **Author:** nnamdi-security (+ Codex agent)
- **Symptom:** PR #417 became conflicting after #416 merged: both added a 12 November entry under SRS change history. The supplier proposal also called new C1 eligibility values entirely additive, omitted commit-time revalidation and promised zone pricing whenever a pickup point was missing.
- **Cause:** Parallel documentation branches edited the same history location. C1 parses a shared closed reason list, so adding values without coordinated clients breaks the screen; an earlier options response cannot protect against a later source edit.
- **Fix / workaround:** Merge development into the PR branch, preserving both SRS entries and the #416 decisions. Record G2/G3 approval, require a separate C1 reason list with backend/client changes together, revalidate eligibility at quote/order/confirmation boundaries and test concurrent edits. Replace the guaranteed zone-price copy with factual road-pricing-unavailable wording. No application or migration changes.
- **Status:** resolved
- **Refs:** PR #417; #407; PR #416; `docs/api/admin-water-sources.md`; `docs/design/admin-water-sources.md`.
