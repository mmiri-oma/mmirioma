# 2026-11-01: Deployment script tests fail on Windows, and Docker stopped mid-session

- **Area:** tooling
- **Author:** Bonvee120 + agent
- **Symptom:** a full `pytest` run in `backend/` on Windows reports 6 failures, all in
  `tests/test_deployment_config.py::TestScripts`:
  `test_is_valid_bash_and_executable[prod.sh]`,
  `test_is_valid_bash_and_executable[production-backup.sh]`,
  `test_is_valid_bash_and_executable[production-migrate.sh]`,
  `test_prod_wrapper_needs_an_env_file`,
  `test_migrate_rejects_unknown_options_before_touching_anything`,
  `test_backup_needs_a_database_password`. The first three fail on
  `assert os.access(path, os.X_OK), f"chmod +x deploy/{name}"`; the others
  raise `CalledProcessError` when they run the scripts. Separately, partway
  through the session `docker ps` began to fail with `failed to connect to the
  docker API at npipe:////./pipe/dockerDesktopLinuxEngine`, so the
  integration tests (which need `TEST_DATABASE_URL`) could not be run.
- **Cause:** the script tests check the Unix executable bit and run the scripts
  with `bash`, which a Windows checkout does not have in the same way. They
  are unrelated to the audit module the session was changing. Docker Desktop's
  engine had stopped.
- **Fix / workaround:** the failures were left alone (no file under `deploy/`
  was touched); CI runs on `ubuntu-latest`. Start Docker Desktop
  before running the integration tests.
- **Also seen (integration run, `mmirioma_fork_test` migrated to 0023):** with
  `TEST_DATABASE_URL` set, the full suite had 1649 passed, 8 failed and 6 errors.
  Besides the six script tests above, `tests/test_quotes_integration.py`
  (`test_manual_reasons_in_the_agreed_order_and_nothing_stored`,
  `test_a_suspended_source_does_not_price`) fails with
  `assert ManualReason.NO_ELIGIBLE_SOURCE is ManualReason.CATEGORY_UNAVAILABLE`,
  and all six tests in `tests/test_demo_seed_integration.py` error with
  `ForeignKeyViolation: update or delete on table "order_events" violates
  foreign key constraint "fk_order_price_snapshots_event_id_order_events"`.
  The test database still held rows from earlier runs (4 demo accounts and a
  water source), which these tests do not expect. None of them touch the audit
  module; the audit tests and `test_admin_operations_integration.py` pass.
  The test database was not cleaned.
- **Status:** workaround
- **Refs:** #296; `backend/tests/test_deployment_config.py`, `deploy/`.
