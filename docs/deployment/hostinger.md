# Deploying MmiriOma on a Hostinger KVM 1 VPS

Runbook for the pilot deployment: one Ubuntu 24.04 VPS (1 vCPU, 4 GB RAM,
50 GB NVMe), Docker Compose, the domain `mmiriomadelivery.com`. Issue
[#282](https://github.com/mmiri-oma/mmirioma/issues/282). Local development is
unchanged (`compose.yaml`).

Status: **prepared, not yet deployed.** Nothing here has been run on the VPS.
What was checked on a development machine is listed under
[Checks done](#checks-done).

## 1. Overview

```text
internet ──► Caddy (80, 443)  ──►  api (FastAPI + the built React app, port 8000)  ──►  db (PostgreSQL 16 + PostGIS 3.4)
             automatic HTTPS        one origin: /api/* and the app                        private network, no published port
```

| Service | Image | Job |
| --- | --- | --- |
| `caddy` | `caddy:2.10-alpine` | HTTPS certificates (Let's Encrypt), `www` redirect, the only published ports (80, 443) |
| `api` | built from `backend/Dockerfile` | `/api/*`, and the React app with `index.html` as the fallback for React Router paths |
| `db` | `postgis/postgis:16-3.4` | the database, on a volume, reachable only by `api` |
| `migrate` | the `api` image | one-off `alembic` commands (profile `tools`, never started by `up`) |

Decisions:

- **No Nginx container.** The API already serves the built frontend on its own
  origin (`backend/app/core/frontend.py`), so a second web server adds memory
  use and a second place to get caching wrong. Caddy sends everything to `api`.
- **One origin.** `https://mmiriomadelivery.com` serves the app and `/api`, so
  the session cookie is first-party and CORS never applies. There is no
  `api.` subdomain; adding one would be a cross-origin setup that needs a
  contract and cookie decision first.
- **Build on the server, tag by commit.** One deployer and one VPS do not
  justify a registry. Each build is tagged `mmirioma-api:<git commit>`, so the
  previous release's image is still on the disk for a rollback.
- **Resend, Geoapify and Paystack are not configured** because the code has no
  integration for them (only Termii for SMS). There is no setting to fill in.

## 2. Files

| File | Job |
| --- | --- |
| `compose.production.yaml` | The stack above: networks, health checks, restart policies, memory limits, log rotation |
| `deploy/Caddyfile` | Routing: `www` redirect, reverse proxy, security headers |
| `.env.production.example` | Template for `.env.production` (never committed) |
| `deploy/prod.sh` | Runs `docker compose` with the right files; tags the image with the git commit |
| `deploy/production-migrate.sh` | Explicit migrations with a destructive-change check and a backup |
| `deploy/production-backup.sh` | Backup, retention, optional off-VPS copy; wraps `deploy/backup.sh` |
| `deploy/restore.sh` | Restore (existing script) |
| `backend/tests/test_deployment_config.py` | Checks these files stay safe and match the code |

## 3. Security model

- **HTTPS everywhere.** Production refuses to start unless `FRONTEND_URL` is
  https (`Settings`), the session cookie is `Secure` and `HttpOnly`
  (`SameSite=lax`), and the API sends `Strict-Transport-Security`. Caddy
  redirects plain HTTP to HTTPS.
- **CSRF.** Unsafe requests need the `X-CSRF-Token` header derived from the
  session (`docs/features/authentication.md`). Nothing at the proxy changes
  headers or cookies, so it works as in development.
- **Trusted proxy.** uvicorn runs with `--proxy-headers` and trusts
  `X-Forwarded-*` only from the Caddy network (`172.28.0.0/24`), not from `*`.
  This matters: the sign-in and SMS rate limits key on the client address
  (`backend/app/modules/auth/rate_limit.py`). Trusting nobody would make every
  customer share Caddy's address and lock each other out; trusting everyone
  would let anyone fake an address. The API has no published port, so only
  Caddy can reach it.
- **Private database.** `db` sits on a network marked `internal`, publishes no
  port, and only `api` (and the `migrate` job and the backup container) join it.
- **No development behaviour.** `compose.production.yaml` forces
  `APP_ENV=production`, `APP_DEBUG=false` and `SMS_PROVIDER=termii`, so the
  file cannot turn them off; production also refuses the mock SMS provider. The
  image is built with `VITE_USE_MOCKS=false`, so the typed demo data is not in
  the bundle. The demo seed (`python -m app.modules.demo.seed`) is a manual
  command: **never run it on production.** There is no payment integration, so
  no payment can be confirmed by a fake callback.
- **Docker and the firewall.** Docker publishes ports around `ufw`. That is
  safe only because Caddy is the one service with `ports:`; a test enforces it.
  Do not add `ports:` to `db` or `api`.
- **Secrets** live only in `.env.production` (mode 600, not in git).

## 4. First-time server preparation

Do this once, on a fresh Ubuntu 24.04 VPS. Replace `deploy` with your user name.

1. **DNS.** At the domain's DNS provider, create A records for
   `mmiriomadelivery.com` and `www.mmiriomadelivery.com` pointing at the VPS's
   public IP. Caddy cannot get certificates until both resolve to the VPS.
   Check: `dig +short mmiriomadelivery.com www.mmiriomadelivery.com`.
2. **A normal user and SSH keys** (as root, once):

   ```bash
   adduser deploy && usermod -aG sudo deploy
   mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
   chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
   ```

   Log in as `deploy` in a second terminal **before** continuing. Then in
   `/etc/ssh/sshd_config.d/10-hardening.conf` set `PermitRootLogin no` and
   `PasswordAuthentication no`, and run `sudo systemctl reload ssh`.
3. **Firewall and automatic updates:**

   ```bash
   sudo ufw default deny incoming && sudo ufw default allow outgoing
   sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443
   sudo ufw enable
   sudo apt update && sudo apt install -y unattended-upgrades fail2ban git
   ```

   Also use Hostinger's panel firewall for the same three ports if you have it.
4. **Swap (2 GB).** The frontend build needs more than the free memory at its
   peak:

   ```bash
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
   sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```

5. **Docker Engine and the Compose plugin**, from Docker's own apt repository:
   follow <https://docs.docker.com/engine/install/ubuntu/>, then
   `sudo usermod -aG docker deploy` and log in again. Check
   `docker compose version`.
6. **Backup folder:** `sudo mkdir -p /var/backups/mmirioma && sudo chown deploy: /var/backups/mmirioma`.

## 5. Initial deployment

```bash
cd ~ && git clone https://github.com/mmiri-oma/mmirioma.git && cd mmirioma
git checkout main        # or the tagged release you are deploying

cp .env.production.example .env.production && chmod 600 .env.production
nano .env.production     # replace every <placeholder>; see "Settings" below

deploy/prod.sh config > /dev/null     # fails fast on a missing or invalid setting
deploy/prod.sh build api              # 5 to 10 minutes on 1 vCPU
deploy/prod.sh up -d db               # database first
deploy/production-migrate.sh          # first install: empty database, backs up, asks "yes"
deploy/prod.sh up -d                  # api, then caddy
deploy/prod.sh ps                     # all three "healthy"
```

Then create the first administrator (section 9), and check from your own
computer:

```bash
curl -i https://mmiriomadelivery.com/api/v1/health/ready   # 200 {"status":"ready",...}
curl -I http://mmiriomadelivery.com                        # 308 to https
curl -I https://www.mmiriomadelivery.com/orders            # 301 to https://mmiriomadelivery.com/orders
curl -I https://mmiriomadelivery.com/some/react/route      # 200 text/html (React Router fallback)
```

In a browser: sign in, reload on a deep link, and confirm the cookie
`mmirioma_session` is `Secure` and `HttpOnly` in the developer tools.

### Settings

`.env.production` is documented line by line in `.env.production.example`. In
short: `SITE_DOMAIN`, `POSTGRES_PASSWORD` (letters and digits only, it goes in a
URL: `openssl rand -hex 24`), `SESSION_SECRET` (32+ characters), and the Termii
settings. Support number and WhatsApp are optional. `VITE_*` values are public
and baked into the bundle at build time, so changing them needs
`deploy/prod.sh build api`. Changing `SESSION_SECRET` signs everyone out.

## 6. Commands

All commands run on the VPS from the repository folder.

| Task | Command |
| --- | --- |
| Status and health | `deploy/prod.sh ps` |
| Follow logs | `deploy/prod.sh logs -f --tail 100 api` (also `caddy`, `db`) |
| Restart one service | `deploy/prod.sh restart api` |
| Restart everything | `deploy/prod.sh restart` |
| Stop / start | `deploy/prod.sh stop` / `deploy/prod.sh up -d` |
| Open a shell in the API | `deploy/prod.sh exec api sh` |
| Database console | `deploy/prod.sh exec db psql -U mmirioma mmirioma` |
| Disk used by Docker | `docker system df` |

Logs rotate at 10 MB x 3 files per service. Caddy's access log holds client
addresses and request paths: treat it as personal data and do not paste it into
issues (`docs/process/privacy-retention.md`).

## 7. Updating from GitHub

```bash
cd ~/mmirioma
git fetch origin && git status              # clean working tree?
git log --oneline HEAD..origin/main         # what is coming
git pull --ff-only origin main              # or: git checkout <release tag>

deploy/prod.sh build api                    # tagged with the new commit; the old image stays
deploy/production-migrate.sh --check        # what would change? (read-only)
deploy/production-migrate.sh                # backup, then migrate, if there is anything pending
deploy/prod.sh up -d api                    # swap to the new image (a few seconds of downtime)
deploy/prod.sh ps && curl -fsS https://mmiriomadelivery.com/api/v1/health/ready
```

Order matters: migrate **after** building and **before** switching the API.
Write migrations so the previous release still works on the new schema (add
before you remove), so the swap is safe either way.

## 8. Migrations

Migrations never run when the API starts. `deploy/production-migrate.sh`:

1. shows the database revision and the release's head;
2. renders the pending SQL (`alembic upgrade <current>:head --sql`, no
   connection) and **stops** if it contains `DROP TABLE`, `DROP COLUMN`,
   `DROP SCHEMA`, `TRUNCATE` or `DELETE FROM`. After a person has reviewed the
   migration, rerun with `--allow-destructive`;
3. takes a backup (`--skip-backup` only for a scratch database);
4. asks you to type `yes`, runs `alembic upgrade head`, and prints the new revision.

Other commands: `--check` shows the state and the destructive check only.
`deploy/prod.sh run --rm migrate history --verbose` and
`deploy/prod.sh run --rm migrate current` run any `alembic` command.

The checks in CLAUDE.md still apply before a migration reaches `main`
(`alembic upgrade head`, `downgrade -1`, `alembic check`).

## 9. Staff accounts and water sources

Staff accounts cannot be created through the API
(`backend/app/modules/auth/cli.py`). Roles are `admin` (dispatcher and
administrator) and `driver` (tanker drivers and Keke riders). The command asks
for the password twice and never takes it as an argument, so it stays out of
shell history:

```bash
deploy/prod.sh exec api python -m app.modules.auth.cli create-user --role admin --name "Full Name" --phone 08012345678
deploy/prod.sh exec api python -m app.modules.auth.cli deactivate --phone 08012345678
deploy/prod.sh exec api python -m app.modules.auth.cli activate --phone 08012345678
```

Use each person's own phone number. Give each person their own account; do not
share one. Do not run the demo seed.

### Water sources

A new deployment has no water sources, and water may only be collected from a
source that is approved for the order's category (FR-012). Quoting and
confirming an order need at least one. There is no admin screen for sources:
the technical lead manages them with the command-line tool
`backend/app/modules/sources/cli.py` (full reference:
[docs/features/water-sources.md](../features/water-sources.md)). `--by` must be
the phone of an active **admin** account (section 9 above), and it becomes the
actor of the audit row.

```bash
# The two seeded categories (potable, utility)
deploy/prod.sh exec api python -m app.modules.sources.cli list-categories

# 1. Add the source. --kind is borehole or ninth_mile. It prints the source id.
deploy/prod.sh exec api python -m app.modules.sources.cli add-source \
  --by 08012345678 --name "Your Borehole A" --location "Ugwuaji, Enugu" --kind borehole

# 2. Activate it for a category. This is the step that makes it usable.
deploy/prod.sh exec api python -m app.modules.sources.cli activate \
  --by 08012345678 --source <source id> --category potable \
  --report LR-0001 --approved-until 2027-01-30 --cost-per-litre-kobo 150

# 3. Check the result
deploy/prod.sh exec api python -m app.modules.sources.cli list-sources
```

Later changes use the same tool: `set-kind --source <id> --kind ninth_mile`,
`suspend` or `revoke` (both need `--reason`), and `activate` again to renew.
On a development machine, run the same commands from `backend/` with
`.venv/bin/python -m app.modules.sources.cli ...`.

Things to know:

- **Activation makes a source usable.** A source with no activation for a
  category is never eligible, so orders for that category cannot be confirmed
  from it.
- **Set the kind for Tanker orders.** A source with no `--kind` matches no
  Tanker customer's source preference, so a Tanker order cannot be quoted or
  confirmed with it. Keke orders accept any kind.
- **Activate only after laboratory verification.** FR-012 requires an
  independent laboratory approval, and the app cannot check it: it stores only
  the report reference (`--report`). For testing, use an obviously fake
  reference such as `LR-TEST`, never one that looks like a real approval.
- **Cost per litre is in kobo** (`--cost-per-litre-kobo`, a whole number). It is
  the supplier's cost, and no client ever sees it. Quotes price the water at
  the highest cost among the eligible sources of the preferred kind.
- **`--approved-until` is the last valid day, inclusive,** in Africa/Lagos time.
  After it the source stops being eligible. Nothing warns anyone beforehand, so
  note the date and renew before it.
- **Suspending does not cancel orders already confirmed** with that source.
- **Every change writes an audit row** (`water_source_added`,
  `water_source_activated`, ...), shown on the Settings page's audit log. Cost,
  report reference and reason are not copied into it.
- **A mistyped name or location cannot be edited** with the tool; it needs a
  database change, so check them before adding.

## 10. Backups

`deploy/production-backup.sh` writes a `pg_dump --format=custom` file named
`mmirioma-<UTC time>.dump` into `/var/backups/mmirioma`, checks that it can be
read back, deletes dumps older than `BACKUP_KEEP_DAYS` (30, the privacy
notice's retention, section 8), and copies the folder off the VPS when
`BACKUP_RCLONE_REMOTE` is set. It uses the same PostGIS image as the database
for the client tools, on the private network.

**Off-VPS target: not chosen yet (placeholder).** Until
`BACKUP_RCLONE_REMOTE` is set the script warns on every run, and the backups
exist only on the server they protect. Choose a target before real customer
data goes in. The script uses [rclone](https://rclone.org/) (installed on the
VPS, not in this repository) with `rclone copy`, which never deletes remote
files; set expiry (about 30 days) as a lifecycle rule on the storage side.
Configure the remote once with `rclone config`, then put its name in
`.env.production`.

Schedule it (`crontab -e` as `deploy`), here every day at 02:30 server time:

```cron
30 2 * * * cd /home/deploy/mmirioma && deploy/production-backup.sh >> /var/backups/mmirioma/backup.log 2>&1
```

Check the log after the first night, and list the folder once a week.

### Restoring

Practise this on a scratch database before you need it (the pilot's restore
test). A restore **replaces** the data, so it is also how a bad migration is
undone.

```bash
deploy/prod.sh stop api caddy                 # stop writes
set -a; . ./.env.production; set +a           # loads POSTGRES_PASSWORD
RESTORE_DATABASE_URL="postgresql://mmirioma:${POSTGRES_PASSWORD}@db:5432/mmirioma" \
BACKUP_USE_DOCKER=1 BACKUP_DOCKER_NETWORK=mmirioma_prod_data \
  bash deploy/restore.sh /var/backups/mmirioma/mmirioma-YYYYMMDDTHHMMSSZ.dump --yes
deploy/prod.sh up -d                          # the API image must match the restored schema
```

The script prints the schema revision and row counts afterwards; compare them
with what you expect. To test without touching production, create a second
database in the same server (`createdb`), point `RESTORE_DATABASE_URL` at it
and compare the counts.

Privacy rule: after a restore, re-apply every deletion and anonymization
recorded since that backup was taken, before the service is used again
(`docs/process/privacy-retention.md`, "Backups"). Record the restore in
`docs/log/`.

## 11. Rolling back

**The application only (no schema change):**

```bash
docker image ls mmirioma-api                         # releases still on this server
git log --oneline -5                                 # find the previous commit
git checkout <previous-commit>                       # keeps the repo in step with the image
APP_VERSION=<previous-commit-12-chars> deploy/prod.sh up -d --no-build api
```

`APP_VERSION` must match the image tag, which is the commit's 12-character
short id (`git rev-parse --short=12 <commit>`). Go back to `main` afterwards
with `git checkout main` when the fix is ready; do not leave the server on a
detached commit unnoticed.

**A release that included a migration.** Prefer restoring the backup that
`production-migrate.sh` took just before (section 10), then starting the old
image. `alembic downgrade` (`deploy/prod.sh run --rm migrate downgrade -1`) is
the alternative only when that migration's downgrade has been reviewed and
cannot lose data; the restore is safer. Customer actions between the backup
and the rollback are lost in a restore: say so to the team and note the time.

**Clean old images** once a release is settled, keeping the last two:
`docker image prune -f` removes untagged layers; remove old tags by hand with
`docker rmi mmirioma-api:<old-commit>`.

## 12. Checks done

On a development machine, not the VPS:

- `deploy/prod.sh config` with a throwaway env file: the stack resolves, with
  only Caddy publishing ports.
- `caddy validate` on `deploy/Caddyfile` with the pinned Caddy image: valid;
  the log shows automatic HTTP to HTTPS redirects enabled.
- `docker compose build api` succeeds; then the whole stack ran on a laptop with
  `localhost` as the domain: the API and Caddy reported healthy, `/api/v1/health/ready`
  returned 200, HTTP redirected to HTTPS (308), `www` redirected to the main
  domain with path and query (301), a React route returned `index.html`, and an
  unknown `/api` path returned the JSON 404. The helper scripts migrated an empty
  database, found 17 pending migrations at an old revision, took a backup and
  restored it into a scratch database.
- `backend/tests/test_deployment_config.py`: 21 checks that the compose file,
  Caddyfile, env template and scripts keep the rules above (verified to fail
  when the compose file is broken on purpose).
- Backend `ruff check`, `ruff format --check` and `pytest` (1353 passed; the
  database integration tests were skipped locally and run in CI); frontend
  lint, typecheck, tests and build pass.

Not yet done, because it needs the real VPS and domain: certificate issuance,
the `curl` checks in section 5, a backup and a restore on the server, a
migration run with the helper script against a populated database.

## 13. Outstanding before go-live

1. **The privacy notice names Railway** as the hosting provider (Amsterdam),
   in the legal page (`frontend/src/features/marketing/LegalPages.tsx`) and
   `PRIVACY_NOTICE.md`. After this move it is wrong. It needs the new
   provider and data-centre location (chosen in Hostinger's panel) and the
   legal review in `docs/process/privacy-retention.md`, "Open items" (item 2).
   Not changed here: it is a legal text.
2. **Off-VPS backup target** (section 10) and a first restore test.
3. **Termii:** sender ID registered, DND channel activated, a live test on a
   team phone (`python -m app.modules.messaging.live_test`, `docs/features/sms.md`).
4. **Email (Resend), maps (Geoapify) and payments (Paystack)** are not in the
   code. If the pilot needs them, each is its own issue with a contract.
5. **Road distance (OSRM)** is still open (SRS section 12.1); pricing uses
   zone rates. KVM 1 is too small to host the map data.
6. **Web push** (VAPID keys) is not implemented; leave `VITE_VAPID_PUBLIC_KEY` unset.
7. **Monitoring:** an external uptime check on `/api/v1/health/ready` and a
   disk-space alert. Nothing is set up.
8. **Continuous deployment:** none. Deploys are manual (section 7).
9. **Water sources:** none exist on a new deployment. Add and activate at
   least one (section 9) before taking orders, with a real laboratory
   report reference.

## 14. Known limitations

- **Single instance.** One API worker (the sign-in rate limits are in process
  memory and are cleared on restart) and one database: a VPS failure means
  downtime until restored from a backup.
- **A few seconds of downtime** while the API container is replaced.
- **Builds on the server** use most of the memory for several minutes; do not
  build during busy hours.
- **Backups only as good as their off-site copy** until a target is chosen.
- **Caddy certificates** live in the `caddy_data` volume; losing it means
  asking Let's Encrypt again (rate limits apply).
