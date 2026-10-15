## What and why

<!-- What changed and why. Link the issue: "Closes #NN". -->

## Workflow gates (docs/process/ui-driven-development.md)

<!-- Tick what applies; delete the rest. -->

- [ ] **Frontend screens or UI components:** the design is approved
      (`docs/design/<slice>.md`, `Status: approved`): <link>
- [ ] **Frontend or business endpoint:** the contract is agreed
      (`docs/api/<area>.md`, `Status: agreed`): <link>
- [ ] **No gate needed:** authentication, infrastructure, SRS-derived
      persistence, or docs only

## How it was tested

<!-- Commands run and results. Backend: ruff, pytest (with integration).
     Frontend: lint, typecheck, test, build. Manual steps if any. -->

## Migration / config impact

<!-- New migrations (reviewed? up/down/check run?), new settings, or "None". -->

## Checklist

- [ ] Docs updated (`docs/features/`, `docs/api/`, architecture) in this PR
- [ ] New problems recorded in `LOG.md`
