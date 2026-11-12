# 2026-11-12: Dispatch contract needed system audit actors and durable manual control

- **Area:** process
- **Author:** nnamdi-security (+ Codex agent)
- **Symptom:** PR #416 proposed automatic dispatch but left dispatcher withdrawal, vehicle matching and six business decisions unresolved. It required system audit records without allowing a null audit actor, and described nullable existing fields as entirely additive.
- **Cause:** The proposal described automatic transitions before tracing the audit model/read joins and persistent state needed to prevent a later tick undoing manual intervention. The SRS and PRD still described the earlier manual-first flow.
- **Fix / workaround:** During the owner-requested review, recorded D4/D5/D7/D8/D9/D10 and all six question answers in the contract. Added persistent manual-only control, delivery-type matching, deadline-boundary behavior, coordinated nullable-actor client changes and safe downgrade limits. Source loss after pickup requires staff review. Amended the SRS and PRD for the approved target. Operating-hour/window details remain gated on #408; no code, migration, provider or deployment was added.
- **Status:** resolved
- **Refs:** PR #416; #411; `docs/api/deliveries.md`; `backend/app/modules/audit/models.py`; `backend/app/modules/audit/service.py`.
