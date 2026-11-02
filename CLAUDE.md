# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DigitoPub is a scientific journal publishing platform built with Next.js 16, React 19, Prisma, and MySQL. It integrates with Open Journal Systems (OJS) for read-only data synchronization.

## Commands

```bash
bun run dev          # Start development server
bun run build        # Build for production (runs prisma generate + migrate deploy)
bun run start        # Start production server (with auto migrations)
bun run lint         # Run ESLint
bun run test         # Run Vitest tests
bun run test:watch   # Run tests in watch mode
bun run test:coverage # Run tests with coverage
bunx prisma generate # Generate Prisma client
bunx prisma studio   # Open Prisma Studio GUI
bun run ojs:sync     # Sync data from OJS database
bun run test path/to/test.test.ts  # Run a single test file
```
## Identity Ownership Model

The system enforces strict identity separation. **The previous "digitopub never holds public-user identity" rule was amended by UIET-P1.** Current rule:

- **digitopub.com**:
  - Owns admin authentication (JWT-based, `auth_token` cookie).
  - **Also** holds an ORCID-derived public-user identity (`digitopub_identity` cookie). ORCID is the SOLE identity provider for public users; digitopub never sees passwords, never validates credentials, never stores email/password tuples.
  - **Publication-alert subscribers are the one exception to "no public emails"** (epic #204). Opt-in subscriber emails are stored in plaintext in `notification_subscribers`: `pending` until the owner confirms (double opt-in), and purged after 90 days if never confirmed. `DELETE /api/account/data` erases them (matched by ORCID iD or verified email hash). Apart from pending author email changes (#233, `person_email_changes`: old and new address of an OJS author, deleted after 30 days and by `DELETE /api/account/data`), this is the ONLY place digitopub stores public users' emails. It is not an identity: subscribers authenticate only by signed links (`src/lib/notification-token.ts`, `NOTIFY_TOKEN_SECRET`), never by cookie or password.
  - The two cookies are wholly separate code paths. Admin auth uses `getSession()` / `jwtVerify`; public auth uses `getIdentity()` / `verifyCookie` from `src/lib/identity-cookie.ts`. They MUST NOT cross-pollinate.

- **submitmanager.com (OJS)**:
  - Owns canonical public-user identities (editorial workflows still require an OJS account).
  - Owns ALL submission and editorial workflows.
  - digitopub writes to OJS only through the guarded, audited functions in `src/lib/ojs-write-guard.ts`. Every write is logged in `audit_ojs_writes` (audit row first). Today there are three:
    - ORCID backfill: when `ENABLE_ORCID_OJS_BACKFILL=true`, the ORCID iD is written into OJS `user_settings` on first email-match login.
    - Journal specialization (#234): an admin's choice of `Journal.field` is written to the OJS journal setting `digitopubSpecialization` through the `set_journal_specialization` action of `ojs-user-bridge.php`, queued in `ojs_sync_jobs` and retried by `POST /api/ojs/cron/push-sync`.
    - Author edits (#233): `updatePersonInOjsWithAudit()` changes an author's name, email and ORCID iD on their OJS account (if any) and on every publication byline with the same email, in one transaction, through the `update_person` action of `ojs-user-bridge.php`. An email or ORCID iD that belongs to someone else is refused (409), never merged. Publication DOIs whose byline changed are marked stale (OJS `markStale` rule) for Crossref re-deposit. Admins edit anyone (`/api/author-profile`, `requireAdmin`); a signed-in author edits only their own record (`/api/account/profile`, `getIdentity()`), and can set only their own verified ORCID iD. "Their own" means the OJS record whose email is the one ORCID verified at sign-in (`identity.email_hash`); byline ORCID iDs are typed in by submitters and are never proof on their own. When records with different names share an email (a submitter's address on co-authors' bylines), the bridge refuses (`ambiguous_person`) unless an admin confirms they are one person (`same_person`); self-service never can. A new email is never written directly: it waits in `person_email_changes` until the new address opens a single-use link (`/api/account/confirm-email`).

## Public-User Identity (UIET-P1) — what changed and why

**Why we added it**: anonymous readers can read OA articles freely. Non-OA articles must be gated, but the prior architecture had no way to identify a returning reader without bouncing them through OJS for every action. We now mint a self-contained, HMAC-signed identity cookie after a single ORCID OAuth round-trip. Sliding 30 min / absolute 8 h.

**Cookie design**:
- Name: `digitopub_identity`. Flags: `httpOnly; Secure; SameSite=Lax; Path=/`. No `Domain` attribute (host-only on `digitopub.com`).
- Payload: `{orcid, ojs_user_id_or_null, email_hash, iat, exp_sliding, exp_absolute, version: 1}`.
- HMAC-SHA256 signed with `IDENTITY_COOKIE_SECRET`.
- ±2 minutes clock-skew tolerance on `iat` and both expiries.
- Revoked via `revoked_orcids.cookie_iat_min` — cookies with `iat < cookie_iat_min` are rejected even if signature and expiries are valid.

**Open access — no gating**:
- PDF view, PDF download, abstract reading, and citation export are ALL open to every visitor regardless of `article.isOpenAccess`, ORCID sign-in state, or any other property.
- An earlier draft of UIET-P1 gated non-OA PDF actions behind the identity cookie; that gate was removed before launch on open-access principle.
- Sign-in is OPT-IN. It exists so signed-in researchers' engagement is attributed to their ORCID iD and so they can use `/account/stats` and `/account/data` (right-to-erasure).
- `/api/pdf-proxy` MUST NOT reject requests on identity grounds. It may inspect the cookie for attribution but never block.

**Engagement tracking**: `user_event` rows are written for views, downloads, and citation exports. Server-side dedup:
- View: once per `(article, identity_or_iphash, UTC day)`.
- Download: once per `(article, galley, identity_or_iphash)` within 30 s.
- Citation export: never deduped.

**Consent**: `digitopub_consent` cookie (NOT `httpOnly`, 1-year expiry, `SameSite=Lax`, host-only). Three modes: `all` (full ip/ua hashing), `essential_only` (no hashes), `pre_consent` (no orcid, no hashes, source='pre_consent'). After 31 dismissals without a choice, the banner becomes modal-locked.

**The hard rules** (enforced by ESLint `no-restricted-imports` in `eslint.config.mjs`, which bans importing `getSession`/`createSession`/`destroySession` and `jose.jwtVerify` in `app/**` and `src/server/routes/**` outside admin paths — there is no separate CI grep):
- NO public route may call `getSession()` or `jose.jwtVerify` directly. Public routes use `getIdentity(request)` from `src/lib/identity-cookie.ts`.
- digitopub writes to OJS ONLY through the functions in `src/lib/ojs-write-guard.ts` (`writeOrcidToOjsWithAudit()`, `setJournalSpecializationInOjsWithAudit()`, `updatePersonInOjsWithAudit()`). Every write produces an `audit_ojs_writes` row. New kinds of OJS write get their own function there and their own explicitly allowlisted bridge action, never a generic "set any setting" path.
- `ENABLE_ORCID_OJS_BACKFILL` defaults to `false` in production. Flip with intent only.
- Submission flow (registration → OJS) is unchanged. digitopub never intercepts submit clicks.

## Legacy SSO Behavior (still in force for the registration handoff)

Two flows exist:

### 1. New User (Provision + SSO)
digitopub → provision → generate token → redirect to OJS

### 2. Returning User (Direct Access)
digitopub → direct link → OJS handles login

digitopub MUST NOT:
- check the OJS public session (no shared cookie ever existed)
- require OJS login for digitopub navigation
- intercept submission clicks

## Architecture

### Backend API (Hono RPC Pattern)

The API uses Hono framework with RPC-style endpoints. The main app is defined in `src/server/app.ts` and mounted at `/api/[[...route]]/route.ts`.

- **Route definitions**: Each feature has a `server/route.ts` file defining Hono routes
- **Standalone routers**: `src/server/routes/` holds routers that are NOT features — notably `auth-orcid` (public ORCID OAuth) and `account`. `/auth/orcid` is deliberately mounted BEFORE `/auth` in `src/server/app.ts` so public identity requests never hit the admin auth router.
- **Global middleware** in `src/server/app.ts`: CORS (from `ALLOWED_ORIGINS`), logger, and a `Cache-Control: no-store` header on all API responses
- **Validation**: Uses `@hono/zod-validator` for request validation with Zod schemas
- **Client**: Use `client` from `src/lib/rpc.ts` for type-safe API calls from frontend

### Feature Structure

Features are organized under `src/features/{feature}/` (~19 features, incl. `journals`, `auth`, `account`, `billing`, `metrics`, `search`, `article-audio`, `admin-analytics`, `email-templates`, `reviews`, `statistics`, `ojs`):
```
src/features/{feature}/
├── server/route.ts    # Hono route definitions
├── server.ts          # Re-exports router
├── schemas/           # Zod validation schemas
├── types/             # TypeScript type definitions
├── api/               # TanStack Query hooks for data fetching
├── hooks/             # React hooks
└── components/        # Feature-specific React components
```

### App Router (Pages)

Pages use Next.js App Router in `app/` directory:
- `app/admin/` - Admin dashboard pages (protected by middleware)
- `app/api/[[...route]]/route.ts` - Mounts the Hono app at `/api/*`
- Root layout: `app/layout.tsx` with ThemeProvider

### API Routes (Hono RPC)

The API is built with Hono and mounted via Next.js catch-all route:
- Main app: `src/server/app.ts` - Composes all feature routers with `/api` base path
- Mount point: `app/api/[[...route]]/route.ts` - Exports Hono handler for Next.js
- Client: `src/lib/rpc.ts` - Type-safe `hc` client for frontend consumption

### Database (Prisma + MySQL)

- Schema: `prisma/schema.prisma` - MySQL with BigInt auto-increment IDs (Prisma 7)
- Client: `src/lib/db/config.ts` - Uses `PrismaMariaDb` adapter from `@prisma/adapter-mariadb`
- Auth: `src/lib/db/auth.ts` - JWT session management (there is no root-level `lib/` directory; everything lives under `src/lib/`)
- Notable UIET-P1/auth models: `UserEvent` (`user_event`), `RevokedOrcid` (`revoked_orcids`), `AuditOjsWrite` (`audit_ojs_writes`), `UserOrcidLink`, `VerificationCode` (`verification_codes`)
- **Important**: All BigInt fields must be serialized using `serializeRecord()` or `serializeMany()` from `src/lib/serialize.ts` before returning JSON responses

### Authentication

- JWT-based auth using `jose` library
- Session management in `src/lib/db/auth.ts`
- Route configuration in `config/routes.ts`:
  - `PUBLIC_ROUTES` - Routes accessible without authentication
  - `ADMIN_ROUTES` - Routes requiring admin/superadmin role
- Middleware in `middleware.ts` protects admin routes
- Auth middleware helpers in `src/lib/auth-middleware.ts`:
  - `requireAuth` - Requires valid session
  - `requireAdmin` - Requires admin or superadmin role
  - `requireRole(...roles)` - Requires specific roles

### OTP Email Verification (auth feature)

- Endpoints in `src/features/auth/server/route.ts`: `POST /auth/register` (generates code), `POST /auth/verify-code`, `POST /auth/resend-code`; verify page at `/admin/verify-code`
- Codes are 6-digit (`crypto.randomInt`), stored **bcrypt-hashed** in `verification_codes` (VARCHAR(72)), 5-minute expiry, with `attempts`/`locked_until` lockout
- Delivery controlled by `OTP_DELIVERY_METHOD`: `console` (default) | `email` | `disabled`. Email path: `src/features/auth/server/send-otp-email.ts` → `sendEmail()` in `src/lib/email/service` (SMTP via nodemailer). Email addresses are masked in logs.

### OJS Integration

Read-only integration with Open Journal Systems database:
- Client: `src/features/ojs/server/ojs-client.ts`
- Configured via `OJS_DATABASE_*` environment variables
- Uses separate MySQL connection pool with retry logic
- **Hard rule — OJS image filenames:** in OJS image settings (`{"name": …, "uploadName": …}`) the file on disk is **`uploadName`**; `name` is only the original filename of the upload and a URL built from it 404s (OJS reads `$setting['uploadName']`, `PKPContextService.php:826`). `parseOjsFilename` must keep `uploadName` first. Swapping it broke every journal cover in production three times (#148, #155 revert, #239). The truth fixtures (`tests/fixtures/ojs-image-settings.json`) are real OJS rows: if they fail, fix the code, never the fixture. Covers are also protected by the sync write guard (`cover-check.ts`), the Sync health warning, and the hourly `cover-monitor` workflow; see `docs/ojs-image-pipeline.md`.

### Other Subsystems

- **Article audio** (`src/features/article-audio/`): audio abstracts with a storage abstraction — S3 adapter and `LocalFileStorage` adapter (for Hostinger); configured via `AUDIO_STORAGE_DIR`, `MAX_FILE_SIZE_MB`
- **Publication notifications** (`src/features/notifications/`, epic #204): discipline taxonomy, subscriber import (XLSX/CSV/TXT), double opt-in alerts. Admin API at `/api/notifications/*` (`requireAdmin`). The public router `src/server/routes/notifications-public.ts` (subscribe, confirm, preferences, one-click unsubscribe) is mounted at the same prefix BEFORE it and authenticates by signed link only, never `getSession()`. ORCID users manage alerts via `/api/account/notifications` (`getIdentity()`).
- **Billing** (`src/features/billing/`): Stripe integration (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`); models `PricingPlan`, `CheckoutSession`, `Subscription`, `Invoice`
- **Recurring jobs**: job logic lives in `src/features/metrics/server/jobs.ts` and is triggered two ways — Bearer-`CRON_SECRET` HTTP endpoints (`POST /api/metrics/cron/{daily,monthly,user,retention}`, plus `GET /api/ojs/sync`) for the production scheduler (the host has no crontab), and thin CLI wrappers in `scripts/` for manual runs. All triggers share `verifyCronSecret()` (`src/lib/cron-auth.ts`, timing-safe), `acquireJobLock()` (`src/lib/cron-lock.ts`, 429 when held), and write a `sync_runs` ledger row via `src/features/ojs/server/sync-runs.ts`. Schedule: `docs/ops/cron-schedule.md`.
- **OJS sync hardening**: journals sync soft-deletes vanished journals (`status: inactive`, never hard-delete), stamps `Journal.last_synced_at`, and refreshes per-journal aggregates into `ojs_journal_snapshots` (watermark-gated on OJS `last_modified`). Drift self-heal uses a versioned count+CRC32 fingerprint over journal identity/locale fields and every mirrored `journal_settings` value, detecting deletions and content edits (legacy count-only path behind `OJS_DRIFT_FINGERPRINT=0`). Each successful sync stores the fingerprint captured before its OJS fetch, so a concurrent later edit remains detectable. `/api/ojs/journals` serves stale-while-revalidate (30 min) with 60 s negative caching on OJS outages.

### Frontend Patterns

- **State Management**: TanStack Query v5 for server state with 5-minute staleTime default
- **API Client**: Use `client` from `src/lib/rpc.ts` for type-safe Hono RPC calls. Pattern: `client.feature.method.$get()`
- **Styling**: Tailwind CSS 4 with Radix UI components in `components/ui/`
- **Theme**: `next-themes` with ThemeProvider in root layout
- **Path aliases**: `@/*` maps to project root, `@/src/*` to src directory
- **Validation**: Zod v4 with `@hono/zod-validator` for API request validation

## Key Conventions

1. **BigInt Serialization**: Always use `serializeRecord()` or `serializeMany()` when returning Prisma records - BigInt cannot be JSON-serialized directly.

2. **API Response Format**:
   ```typescript
   // Success
   { success: true, data: ..., message?: "..." }
   // Paginated
   { success: true, data: [...], pagination: { page, limit, total, totalPages } }
   // Error
   { success: false, error: "..." }
   ```

3. **Feature Route Pattern**:
   ```typescript
   // server/route.ts
   const app = new Hono()
   app.get("/", async (c) => { ... })
   app.post("/", requireAdmin, zValidator("json", schema), async (c) => { ... })
   export { app as featureRouter }
   ```

4. **Pagination**: Use `parsePagination(c)` and `paginatedResponse()` from `src/lib/pagination.ts`

5. **Database IDs**: All IDs are BigInt. When accepting ID params, convert with `BigInt(id)`.

## Environment Variables

Validation lives in `src/lib/env.ts` (schemas are split so metrics/identity paths don't all require ORCID; `requiredSecret()` throws in production for identity secrets). Full reference: `docs/system_variables.md`, `.env.example`, `.env.production.template`.

Core:
- `DATABASE_URL` or `DATABASE_HOST/PORT/NAME/USER/PASSWORD` - MySQL connection
- `JWT_SECRET` - Secret for JWT signing
- `NEXT_PUBLIC_APP_URL` - Public URL for the app
- `ALLOWED_ORIGINS` - CORS allowed origins (comma-separated)

Identity / UIET-P1 (required in production):
- `IDENTITY_COOKIE_SECRET`, `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`, `ORCID_STATE_SECRET`, `ORCID_REDIRECT_URI`, `EVENT_IP_HASH_SALT_SEED`
- `ENABLE_ORCID_OJS_BACKFILL` (defaults OFF in production), `UIET_P1_ENABLED`

Email / OTP:
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM_EMAIL`
- `OTP_DELIVERY_METHOD` (`console` | `email` | `disabled`)

OJS integration:
- `OJS_DATABASE_HOST`, `OJS_DATABASE_PORT`, `OJS_DATABASE_NAME`, `OJS_DATABASE_USER`, `OJS_DATABASE_PASSWORD`
- `OJS_BASE_URL`, `PUBLIC_OJS_BASE_URL`, `NEXT_PUBLIC_OJS_BASE_URL`, `OJS_API_URL`, `OJS_API_KEY`, `OJS_DRIFT_CHECK_INTERVAL_MS`

Other: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `AUDIO_STORAGE_DIR`, `MAX_FILE_SIZE_MB`, `CRON_SECRET`, `SSO_SECRET`

## Testing

Tests are in `tests/` directory:
- `tests/unit/` - Unit tests for schemas and utilities
- `tests/integration/` - Integration tests for API routes

Run with `bun run test`. Vitest, Node environment, `globals: true`, forked pool with `fileParallelism: false` (test files run sequentially — don't assume parallel isolation issues). Vitest aliases: `@` → project root, `@/src` → `./src`.

## Docs & Specs

- `specs/UIET-P1/` - full spec, plan, data model, and API contracts for the public-identity/engagement-tracking system
- `docs/system_variables.md` - environment variable reference
- `docs/` also contains architecture, Hostinger deployment, and OJS image pipeline reports

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
