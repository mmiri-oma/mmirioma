# 2026-11-01: Issue #309 named a Hostinger "Water sources" section that did not exist

- **Area:** process
- **Author:** Bonvee120 + agent
- **Symptom:** issue #309 says "The walkthrough is now in
  [docs/deployment/hostinger.md](docs/deployment/hostinger.md), 'Water
  sources'", and its Done when asks to update that file so the command-line
  steps become the fallback. `grep -n -i "water source\|add-source"
  docs/deployment/hostinger.md` finds nothing on `origin/development`, and no
  commit that touched the file mentions water sources.
- **Cause:** the section was probably written on a branch that was not merged
  when the issue was filed. Not confirmed.
- **Fix / workaround:** added a short "Water sources" subsection to section 9
  of `hostinger.md` with the real command-line steps (taken from
  `backend/app/modules/sources/cli.py`) and a pointer to the admin endpoints,
  so the fallback is documented where the issue expects it. If the original
  section turns up on another branch, merge the two.
- **Update (2026-11-01):** the section had been written separately in commit `52a73c2`
  (docs(deploy): add the water sources setup steps to the Hostinger guide) and
  reached `development` while PR #315 was open. The two were merged in `c6d7960`,
  keeping the fuller text of `52a73c2`. The wording now points to the Water
  sources page.
- **Status:** resolved
- **Refs:** #309; `docs/deployment/hostinger.md`.
