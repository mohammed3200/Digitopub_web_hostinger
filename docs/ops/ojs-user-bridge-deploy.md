# Deploying `ojs-user-bridge.php` to OJS (SiteGround)

The bridge lives in the repo at `submit-manager-database-schema-ojs/ojs-user-bridge.php`
and runs next to OJS's `index.php` at `~/www/submitmanager.com/public_html/` on
SiteGround (`ssh siteground`). The app deploys itself from `main`; the bridge
does not. Deploy it by hand after the app, because an older bridge answers new
actions with "Unknown action" (the app reports that as "OJS unavailable" and
writes nothing).

Actions: `provision_user` (default), `set_journal_specialization` (#234),
`update_person` (#233). Each is listed explicitly; there is no generic
"set any field" action.

## Steps

1. **Back up** the live file:
   `ssh siteground 'cd ~/www/submitmanager.com/public_html && cp -p ojs-user-bridge.php ojs-user-bridge.php.bak-$(date +%F)'`
2. **Upload** the repo copy:
   `scp submit-manager-database-schema-ojs/ojs-user-bridge.php siteground:www/submitmanager.com/public_html/ojs-user-bridge.php`
3. **Compare** SHA-256 of the repo copy and the live file; they must match:
   `sha256sum submit-manager-database-schema-ojs/ojs-user-bridge.php; ssh siteground 'sha256sum ~/www/submitmanager.com/public_html/ojs-user-bridge.php'`
4. **Check read-only**: open an author in `/admin/authors` → Edit. The page loads
   through an `update_person` dry run, which rolls back and writes nothing.
5. **Roll back** if anything fails: copy the `.bak-…` file back over the live one.

## Testing locally

`tests/integration/ojs-user-bridge-update-person.test.ts` runs the bridge
under `php -S` against a local OJS schema database (import
`submit-manager-database-schema-ojs/*.sql`). It is skipped unless
`OJS_BRIDGE_TEST_DATABASE_URL` is set, for example
`mysql://app_user:…@127.0.0.1:3307/ojs_test`. It loads `pdo_mysql` with
`-d extension=pdo_mysql` when php.ini doesn't enable it. Never point it at
production.

## Rotating the shared secret (optional)

The bridge authenticates with a Bearer secret: `OJS_API_KEY` on Hostinger, and
`[digitopub] api_key` in OJS `config.inc.php` (or an `OJS_API_KEY` env var
there). OJS itself has no API key to generate; this secret is ours.

1. Generate a value on your machine, for example `openssl rand -hex 32`, without pasting it anywhere public.
2. Set `[digitopub] api_key` in `config.inc.php` over SSH, and `OJS_API_KEY` in the Hostinger env.
3. Redeploy the app, then check that an author edit page loads (dry run) and that
   `/admin/journals` → "Specializations & OJS sync" shows no errors.

Both sides must change in the same window: until they match, every bridge call
answers 403.

## Crossref after author edits

`update_person` marks a changed publication's DOI stale (status 2/3 → 5), as
OJS does when metadata changes. Journals with automatic deposit re-deposit
stale DOIs themselves. For the others, deposit them in OJS → DOIs.
