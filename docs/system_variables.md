# System Variables Inventory

All environment variables required by the DigitoPub platform.

---

## Database (MySQL/MariaDB) — REQUIRED

| Variable | Description | Default | Used By |
|----------|-------------|---------|---------|
| `DATABASE_URL` | Full MySQL connection string for Prisma | — | `prisma.config.ts`, `lib/db/init.ts` |
| `DATABASE_HOST` | Database server hostname | `localhost` | `lib/db/config.ts`, `lib/db/init.ts` |
| `DATABASE_PORT` | Database server port | `3306` | `lib/db/config.ts`, `lib/db/init.ts` |
| `DATABASE_NAME` | Database name | `scientific_journals_db` | `lib/db/config.ts`, `lib/db/init.ts` |
| `DATABASE_USER` | Database user | `root` | `lib/db/config.ts`, `lib/db/init.ts` |
| `DATABASE_PASSWORD` | Database password | `""` | `lib/db/config.ts`, `lib/db/init.ts` |

---

## Authentication — REQUIRED

| Variable | Description | Default | Used By |
|----------|-------------|---------|---------|
| `JWT_SECRET` | Secret key for JWT signing/validation (min 64 chars recommended) | — | `lib/db/auth.ts`, `middleware.ts` |

---

## Application & Security — REQUIRED

| Variable | Description | Default | Used By |
|----------|-------------|---------|---------|
| `NODE_ENV` | Node environment (`development` / `production`) | `development` | Multiple |
| `NEXT_PUBLIC_APP_URL` | Public-facing application URL | `http://localhost:3000` | `src/lib/rpc.ts` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | — | `src/server/app.ts` |
| `TRUSTED_PROXY_HOPS` | Proxies in front of the app that append to `X-Forwarded-For`. The client IP for rate limits is the entry this many places from the right (#194). Production (Hostinger proxy + CDN) needs `1`; check with `GET /api/ops/client-ip` (CRON_SECRET) before changing it | `1` | `src/lib/ip-hash.ts` (`clientIpFromHeaders`) |
| `NEXT_PUBLIC_DIMENSIONS_BADGES` | `true` shows the official Dimensions citation badge on article pages and cards instead of our Crossref/OpenAlex hexagon (#258). Dimensions' terms require a publisher licence (publishing@digital-science.com); keep it off until DigitoPub is registered. Inlined at build time: change it, then redeploy | off | `components/citation-badge.tsx`, `components/dimensions-badge.tsx` |
| `NOTIFY_TOKEN_SECRET` | HMAC secret for publication-alert confirm, manage and unsubscribe links. **Required in production**; rotating it invalidates every link already emailed | dev default with warning | `src/lib/env.ts` (`getNotifyEnv`), `src/lib/notification-token.ts` |

---

## OJS External Database — OPTIONAL

Only required if integrating with an Open Journal Systems instance. The pool is lazily initialized — if these are not set, OJS features return `{ configured: false }`.

| Variable | Description | Default | Used By |
|----------|-------------|---------|---------|
| `OJS_DATABASE_HOST` | OJS database hostname | — | `src/features/ojs/server/ojs-client.ts` |
| `OJS_DATABASE_PORT` | OJS database port | `3306` | `src/features/ojs/server/ojs-client.ts` |
| `OJS_DATABASE_NAME` | OJS database name | — | `src/features/ojs/server/ojs-client.ts` |
| `OJS_DATABASE_USER` | OJS database user (read-only recommended) | — | `src/features/ojs/server/ojs-client.ts` |
| `OJS_DATABASE_PASSWORD` | OJS database password | `""` | `src/features/ojs/server/ojs-client.ts` |
| `OJS_SYNC_ENABLED` | Enable/disable OJS sync cron | `false` | Configuration only |
| `OJS_SYNC_INTERVAL_MINUTES` | Sync interval in minutes | `360` | Configuration only |
| `OJS_API_KEY` | Bearer key for the OJS PHP bridges; must match `[digitopub] api_key` in OJS `config.inc.php` | — | `src/features/ojs/server/ojs-client.ts`, `ojs-pdf-stream.ts` |
| `OJS_USER_BRIDGE_URL` | Full URL of `ojs-user-bridge.php` (user provisioning, journal specialization sync #234, author edits #233; deploy: `docs/ops/ojs-user-bridge-deploy.md`) | `${OJS_BASE_URL}/ojs-user-bridge.php` | `src/features/ojs/server/ojs-client.ts` |
| `OJS_BRIDGE_URL` | Full URL of the **PDF** bridge `ojs-pdf-bridge.php` (alias `OJS_PDF_BRIDGE_URL`). Not used for user/journal writes. | derived from `OJS_BASE_URL` | `src/features/ojs/server/ojs-pdf-stream.ts` |

---

## File Uploads — OPTIONAL

| Variable | Description | Default | Used By |
|----------|-------------|---------|---------|
| `MAX_FILE_SIZE_MB` | Maximum upload file size in MB | `50` | Upload handlers |
| `NOTIFICATIONS_ENABLED` | Kill switch for publication-alert crons (detect, digests, send). Anything other than `true` makes them no-ops | `false` | `src/features/notifications/server/config.ts` |
| `NOTIFY_IMPORT_MAX_ROWS` | Maximum data rows per uploaded notification subscriber list | `10000` | `src/features/notifications/server/config.ts` |
| `NOTIFY_SMTP_HOST` | SMTP host for publication-alert mail | Falls back to `SMTP_HOST` | `src/lib/email/notification-transport.ts` |
| `NOTIFY_SMTP_PORT` | SMTP port for publication-alert mail | Falls back to `SMTP_PORT` | `src/lib/email/notification-transport.ts` |
| `NOTIFY_SMTP_SECURE` | TLS mode for publication-alert mail | Falls back to `SMTP_SECURE` | `src/lib/email/notification-transport.ts` |
| `NOTIFY_SMTP_USER` | SMTP user for the alerts sender mailbox | Falls back to `SMTP_USER` | `src/lib/email/notification-transport.ts` |
| `NOTIFY_SMTP_PASSWORD` | SMTP password for the alerts sender mailbox | Falls back to `SMTP_PASSWORD` | `src/lib/email/notification-transport.ts` |
| `NOTIFY_SMTP_FROM_EMAIL` | From address for publication-alert mail (e.g. `alerts@digitopub.com`) | Falls back to `SMTP_FROM_EMAIL` | `src/lib/email/notification-transport.ts` |
| `NOTIFY_FROM_NAME` | Default display name in the From header of alert mail (journal messages use the journal title) | `DigitoPub` | `src/lib/email/notification-transport.ts` |
| `NOTIFY_MAX_PER_RUN` | Maximum alert emails sent per send-cron run | `20` | `src/features/notifications/server/config.ts` |
| `NOTIFY_MAX_PER_HOUR` | Maximum alert emails sent per hour. Set to about 80% of the hosting plan's SMTP limit | `60` | `src/features/notifications/server/config.ts` |
| `NOTIFY_MAX_PER_DAY` | Maximum alert emails sent per day. Set to about 80% of the hosting plan's SMTP limit | `300` | `src/features/notifications/server/config.ts` |
| `NOTIFY_UNSUBSCRIBE_MAILTO` | Optional mailbox for the `mailto:` entry in the List-Unsubscribe header. Unset, only the https one-click URL is sent | Unset | `src/lib/email/notification-transport.ts` |
| `ALLOWED_FILE_TYPES` | Comma-separated allowed extensions | `pdf,doc,docx,txt,jpg,png` | Upload handlers |
| `UPLOAD_DIR` | Directory for file uploads | `./uploads` | Upload handlers |

---

## Seeding Credentials — REQUIRED (First Deploy)

Used by `lib/db/init.ts` during runtime database initialization to create privileged accounts.

| Variable | Description | Default | Used By |
|----------|-------------|---------|---------|
| `ADMIN_EMAIL` | Super admin email address | — | `lib/db/init.ts` |
| `ADMIN_PASSWORD` | Super admin password | — | `lib/db/init.ts` |
| `SUPPORT_EMAIL` | Support user email address | — | `lib/db/init.ts` |
| `SUPPORT_PASSWORD` | Support user password | — | `lib/db/init.ts` |

---

## Runtime Initialization — REQUIRED

| Variable | Description | Default | Used By |
|----------|-------------|---------|---------|
| `ALLOW_PROD_DB_INIT` | Set to `"true"` to enable auto migration + seeding on startup | `false` | `lib/db/init.ts` |
| `OTP_DELIVERY_METHOD` | OTP delivery: `"console"`, `"email"`, or `"disabled"` | `"disabled"` (prod) / `"console"` (dev) | `src/features/auth/server/route.ts` |
