# 2026-11-12: A removed service function was still called by an integration test

- **Area:** backend
- **Author:** DevBonavee (+ Claude Code)
- **Symptom:** after #407 replaced `sources.service.eligible_sources` with
  `sources.eligibility.eligible_sources_for`, the unit suite passed but the
  integration run failed one test:
  `tests/test_road_distance_integration.py::test_a_pickup_point_is_set_read_changed_cleared_and_audited_without_the_coordinates`
  with `AttributeError: module 'app.modules.sources.service' has no attribute 'eligible_sources'`.
- **Cause:** the search for callers before removing the function was a
  `grep` whose pattern also matched unrelated names, and its output was cut
  short, so the call inside an integration test went unnoticed. Integration
  tests are skipped without `TEST_DATABASE_URL`, so the unit run could not
  catch it.
- **Fix / workaround:** the test now calls `eligible_sources_for` with an
  `OrderFit` and keeps the eligible sources. Before removing a function, search
  for its exact name (`grep -rn "\.eligible_sources(" app tests`), and run the
  integration suite before opening the PR.
- **Status:** resolved
- **Refs:** #407, `backend/tests/test_road_distance_integration.py`
