# 2026-11-12: Routing research found soft quotas and an inspection polling mistake

- **Area:** tooling
- **Author:** nnamdi-security (+ Codex agent)
- **Symptom:** An inspection poll returned `write_stdin failed: Unknown process id 0`. Separately, the candidate provider's pricing page describes soft quotas, so a free plan alone does not establish a hard zero-spend limit.
- **Cause:** The poll used an identifier that was not returned by the shell tool. Provider limits and account terms must be checked independently of the free-plan headline.
- **Fix / workaround:** Confirmed the fetch through the updated local remote-tracking revision and used normal sequential reads afterward; no files or history were lost. The #408 proposal records persistent budget protection and account/terms/privacy review before activation. Poll only actual session IDs returned by the shell tool.
- **Status:** resolved
- **Refs:** #408; `docs/architecture/routing-provider-408.md`; `docs/api/road-pricing-and-eta.md`.

Follow-up: a local documentation assertion for `not validated` failed after
line wrapping split the phrase. The check now normalizes whitespace first;
the owner-decision and JSON checks pass. No product behavior was involved.
