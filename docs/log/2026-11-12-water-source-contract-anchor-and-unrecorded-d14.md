# 2026-11-12: Water-source contract had a dead #385 link, and D14 was only in the issue

- **Area:** process
- **Author:** DevBonavee (+ Claude Code)
- **Symptom:** In `docs/api/admin-water-sources.md`, the 2026-11-03 row of the
  Changes table linked to `#proposed-amendment-385-a-source-location`. No
  heading has that anchor: the section was renamed to "Amendment #385: a
  source `location` (built in #385)" when it was agreed, so the link went
  nowhere. Separately, decision D14 from #407 (what "approved quantities" and
  "vehicle suitability" mean as data) was written only in the issue body, so
  the contract could not cite a recorded answer.
- **Cause:** The heading was renamed after agreement without updating the link
  to it. The 2026-11-05 dispatch plan's decisions were put in the issues and
  not copied into `docs/`.
- **Fix / workaround:** The link now points to
  `#amendment-385-a-source-location-built-in-385`. D14 is recorded in the #407
  contract amendment's Decisions table as the issue's recommendation, chosen by
  the assignee, for a reviewer to agree at G3. When you rename a heading,
  search the repository for its old anchor. When an issue asks for a decision,
  record the answer in the contract or design it affects.
- **Status:** resolved
- **Refs:** #407, #385, `docs/api/admin-water-sources.md`
