# 2026-11-12: Dispatch design inferred searching and expiry from incomplete evidence

- **Area:** frontend
- **Author:** nnamdi-security (+ Codex agent)
- **Symptom:** PR #419 said the system keeps searching whenever an order awaits assignment and declared an offer ended when the device timer reached zero. It also prescribed `None yet` for other table statuses and omitted escalation from the visible timeline.
- **Cause:** The proposal treated a status and device clock as proof of backend activity/outcome, and did not reconcile the detail's persisted escalation timestamp or preserve existing returned rider data.
- **Fix / workaround:** Use neutral waiting copy; check authoritative offer state at timer zero, preserve in-flight answers and handle skew/offline/404 without inventing expiry. Display one escalation timeline fact from the detail without fabricating a transition. Preserve rider values and use neutral last-minute wording. Resolve all six design questions, add accessibility/concurrency build checks and retain visual mockup/dependency gates. No runtime change.
- **Status:** resolved
- **Refs:** PR #419; #411; `docs/design/automatic-dispatch.md`; `docs/design/prompts/21-automatic-dispatch.md`.
