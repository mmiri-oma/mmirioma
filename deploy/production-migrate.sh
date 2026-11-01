#!/usr/bin/env bash
# Apply database migrations to production, explicitly and with a safety check.
#
# Migrations never run when the API starts. Run this after `deploy/prod.sh build api`
# and before `deploy/prod.sh up -d api`:
#
#   deploy/production-migrate.sh              # check, back up, ask, migrate
#   deploy/production-migrate.sh --check      # only show what is pending
#   deploy/production-migrate.sh --allow-destructive   # accept DROP/DELETE/TRUNCATE
#   deploy/production-migrate.sh --skip-backup         # only for a scratch database
#
# What it does:
#  1. Shows the database's current revision and the release's head.
#  2. Renders the pending SQL (alembic --sql, no connection) and stops if it
#     contains DROP TABLE/COLUMN/SCHEMA, TRUNCATE or DELETE FROM, unless
#     --allow-destructive is given after someone has reviewed the migration.
#  3. Takes a backup (deploy/production-backup.sh) so a bad migration can be
#     undone by restoring, which is safer than a downgrade.
#  4. Asks for "yes", then runs `alembic upgrade head`.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
prod="$here/prod.sh"
check_only=0; allow_destructive=0; skip_backup=0
for arg in "$@"; do
  case "$arg" in
    --check) check_only=1 ;;
    --allow-destructive) allow_destructive=1 ;;
    --skip-backup) skip_backup=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# </dev/null: compose must not read the confirmation answer meant for `read` below.
alembic() { "$prod" run --rm -T migrate "$@" </dev/null; }

"$prod" up -d --wait db >/dev/null
current="$(alembic current 2>/dev/null | awk 'NR==1 {print $1}')"
echo "Database revision: ${current:-none (empty database)}"
echo "Release head:      $(alembic heads 2>/dev/null | awk 'NR==1 {print $1}')"

if [[ -z "$current" ]]; then
  echo "Empty database: a first install, nothing to destroy. Skipping the destructive check."
else
  # A failed render must stop the script: an empty result would read as
  # "Nothing pending" and the release would start on the old schema (#320).
  render_err="$(mktemp)"
  if ! sql="$(alembic upgrade "${current}:head" --sql 2>"$render_err")"; then
    echo "Could not render the pending migrations as SQL, so nothing was checked or migrated:" >&2
    cat "$render_err" >&2
    rm -f "$render_err"
    echo "Fix the error above, then run this script again (docs/deployment/hostinger.md, \"Migrations\")." >&2
    exit 1
  fi
  rm -f "$render_err"
  # With nothing pending alembic still prints BEGIN/COMMIT; "Running upgrade" marks real work.
  # (Counted, not `grep -q`: -q closes the pipe early and pipefail would fail the check.)
  pending="$(printf '%s\n' "$sql" | grep -c 'Running upgrade' || true)"
  if [[ "$pending" -eq 0 ]]; then echo "Nothing pending."; exit 0; fi
  echo "Pending migrations: $pending."
  hits="$(printf '%s\n' "$sql" | grep -Ei 'DROP (TABLE|COLUMN|SCHEMA)|TRUNCATE|DELETE FROM' || true)"
  if [[ -n "$hits" ]]; then
    echo "DESTRUCTIVE statements found:" >&2
    printf '%s\n' "$hits" >&2
    if [[ $allow_destructive -ne 1 ]]; then
      echo "Stopped. Review the migration, then rerun with --allow-destructive." >&2
      exit 1
    fi
    echo "Continuing: --allow-destructive was given."
  fi
fi

[[ $check_only -eq 1 ]] && exit 0

if [[ $skip_backup -ne 1 ]]; then "$here/production-backup.sh"; fi

read -r -p "Run 'alembic upgrade head' on production? Type yes: " answer
[[ "$answer" == "yes" ]] || { echo "Cancelled."; exit 1; }
alembic upgrade head
alembic current 2>/dev/null
