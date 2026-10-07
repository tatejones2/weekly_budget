# WEEKLY — a weekly budget with carryover

A personal expense tracker. You get a weekly allowance (default **$150**), Monday–Sunday weeks, and **automatic carryover**: what you don't spend makes next week bigger, what you overspend makes it smaller. Your own account, your own data — nothing shared between users.

React + Vite + TypeScript on the client; Express + PostgreSQL (raw `pg`, no ORM) on the server. Luxon for dates, Vitest for tests.

Live at <https://weekly.tatercooks.com>.

## Commands

```bash
npm install
npm run db:up       # start a local dev Postgres (docker compose, port 5434)
npm run db:migrate  # apply schema migrations
npm run dev          # vite + the API server together (http://localhost:5173)
npm run build        # typecheck (client + server) + production build into dist/
npm run server        # run just the API server (serves dist/ in production)
npm run test          # run the full test suite once — needs DATABASE_URL set
npm run test:watch
npm run typecheck
npm run db:down
```

Tests need a real Postgres (`DATABASE_URL` env var) — `server/repo.test.ts` and `src/tests/workflow.test.tsx` run against it directly rather than mocking the database. `npm run db:up` starts one; CI runs an equivalent `postgres:16-alpine` service container.

## How the money works

All amounts are **integer cents** (`bigint` columns in Postgres — the app's `MAX_CENTS` exceeds a 32-bit `integer`'s range). Nothing derived is stored — every week is recomputed from the ledger, so editing or deleting an old purchase automatically updates every later week.

```
startingAvailable(W) = baseAllowance(W) + carryIn(W)
remaining(W)         = startingAvailable(W) − spent(W)      (refunds reduce spent)
carryIn(W+1)         = remaining(W)                          (may be negative)
```

- Weeks run Monday 00:00 – Sunday 23:59. A transaction belongs to the week of its **date**, not when it was entered.
- Dates are stored as plain `YYYY-MM-DD` calendar days, so week assignment can't drift with time zones or daylight saving. The configured time zone only decides what "today" is (and it rolls over at local midnight).
- Weeks with no spending still add the base allowance. Nothing before the first tracked Monday is invented.
- Budget changes take effect from a chosen Monday (default: next Monday); earlier weeks keep their old amount.
- Daily suggestion = `max(remaining, 0) / days left including today`, rounded **down** to the cent. Overspent weeks show `$0.00/day`, never a negative allowance.

Core logic lives in `src/features/budget/calc.ts` (pure functions, fully unit-tested, used unchanged on both the client and the server).

## Shortcuts (frequent purchases)

- **Fixed** — prefills place, category and a set price (e.g. Bojangles $15.67). Editing one purchase never changes the shortcut.
- **Variable** — prefills place and category, always leaves the amount blank (groceries, gas).
- Shortcuts never create or deduct anything by themselves, and the app never auto-classifies a merchant — it asks.

Press **N** anywhere (outside a text field) to open the Add expense form.

## Accounts and data

Sign in from any device or browser and you see the same data — it lives in PostgreSQL, not the browser. A session is a random token whose **hash** (not the token itself) is stored server-side; the browser only ever holds an httpOnly cookie, never the password, which is salted and hashed with scrypt.

Use **Settings → Your data** to download a **JSON backup** (complete: settings, budget history, categories, shortcuts, transactions; includes `schemaVersion`) and restore it later. Import validates the whole file — both client-side for an immediate preview, and again server-side before writing anything — and replaces current data in a single atomic transaction; an invalid file never changes anything. **CSV** export is a readable list for spreadsheets and can't restore the app.

No analytics, no third-party requests (the Inter font is bundled), no ads.

## Project layout

```
server/         Express API: db.ts (pg pool), auth.ts (sessions/scrypt),
                 repo.ts (every query, user-scoped), app.ts (routes),
                 migrate.ts + migrations/ (plain .sql, tracked in
                 schema_migrations)
src/
  api/          fetch-based client for the server (client.ts)
  app/          providers (auth, data, toasts), shell, routes, dataBus
  components/   Modal, charts, combobox, rows
  features/     auth · budget · expenses · templates · insights · settings
                 · onboarding
  db/           domain types, starter categories, repo.ts (API-client
                 wrappers with the same shape the old Dexie repo had)
  lib/          money, dates, validation, backup (pure — shared with the
                 server), theme
  styles/       tokens (light/dark), base, components, pages
  tests/        money, dates, budget rules, UI workflow (integration test
                 against the real server)
```

Every table is scoped by `user_id` (composite `(user_id, id)` primary keys — the starter category ids like `cat-dining` are the same literal strings for every account, so a bare `id` primary key would let the first account permanently claim them). To change the schema, add a new numbered file to `server/migrations/`; `npm run db:migrate` applies anything not yet in `schema_migrations`. To rename the app, edit `index.html`, the brand in `src/app/Shell.tsx` / `Onboarding.tsx` / `AuthPage.tsx`.

## Deploying

A single Docker image (see `Dockerfile`) builds the client with Vite and runs the Express server, which serves the compiled app and the `/api/*` routes from the same origin. `docker-compose.production.yml` runs it alongside its own PostgreSQL database — `deployment/bootstrap-droplet.sh` creates an isolated database and a least-privilege role (no access to any other app's data on a shared Postgres instance), and `deployment/backup-weekly.sh` / `RESTORE.md` cover daily backups and restores. CI (`.github/workflows/deploy.yml`) builds and pushes the image to GHCR, then a tightly-scoped deploy key (forced to run exactly one command — pull and restart, no shell) updates the running container.

## Accessibility

Semantic landmarks and skip link, visible focus, keyboard-operable forms and combobox, dialogs via native `<dialog>`, `prefers-reduced-motion` and light/dark support, tap targets ≥ 44px, and meaning is never carried by colour alone (signs, labels, hatching for overspend, text alternatives for charts with companion tables).
