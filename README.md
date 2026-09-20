# WEEKLY — a weekly budget with carryover

A private, local-first expense tracker. You get a weekly allowance (default **$150**), Monday–Sunday weeks, and **automatic carryover**: what you don't spend makes next week bigger, what you overspend makes it smaller. No account, no server, no cost to run.

React + Vite + TypeScript · Dexie (IndexedDB) · Luxon · Vitest.

## Commands

```bash
npm install
npm run dev        # dev server (http://localhost:5173)
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build locally
npm run test       # run the test suite once
npm run test:watch
npm run typecheck
```

## How the money works

All amounts are **integer cents**. Nothing derived is stored — every week is recomputed from the ledger, so editing or deleting an old purchase automatically updates every later week.

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

Core logic lives in `src/features/budget/calc.ts` (pure functions, fully unit-tested).

## Shortcuts (frequent purchases)

- **Fixed** — prefills place, category and a set price (e.g. Bojangles $15.67). Editing one purchase never changes the shortcut.
- **Variable** — prefills place and category, always leaves the amount blank (groceries, gas).
- Shortcuts never create or deduct anything by themselves, and the app never auto-classifies a merchant — it asks.

Press **N** anywhere (outside a text field) to open the Add expense form.

## Where your data lives

Data is stored in **IndexedDB in this browser profile on this device**. It survives refreshes and restarts, but:

- it does **not** sync between devices or browsers,
- clearing site data (or a private window) will show an empty app.

Use **Settings → Your data** to download a **JSON backup** (complete: settings, budget history, categories, shortcuts, transactions; includes `schemaVersion`) and restore it later. Import validates the whole file first, shows a preview, and replaces current data in a single atomic transaction — an invalid file never changes anything. **CSV** export is a readable list for spreadsheets and can't restore the app. The app asks the browser for persistent storage on first run and nudges you if you haven't backed up in 30 days.

No analytics, no third-party requests (the Inter font is bundled), no API keys.

## Project layout

```
src/
  app/          providers, shell, routes
  components/   Modal, charts, combobox, rows
  features/     budget · expenses · templates · insights · settings · onboarding
  db/           Dexie schema, repository (all writes), backup/import, CSV
  lib/          money, dates, validation, theme
  styles/       tokens (light/dark), base, components, pages
  tests/        money, dates, budget rules, backup/repo, form workflows
```

To change the schema, add a `this.version(n).stores(...).upgrade(...)` block in `src/db/db.ts` and bump `BACKUP_SCHEMA_VERSION` if the backup format changes. To rename the app, edit `index.html`, the brand in `src/app/Shell.tsx` / `Onboarding.tsx`.

## Deploying (static hosting)

`npm run build` produces a static site in `dist/`. Vite is configured with `base: './'` and the router uses the URL hash (`/#/transactions`), so it works from any sub-path with **no server rewrite rules** — GitHub Pages (project or user site), Netlify, Cloudflare Pages, S3, or a plain folder.

GitHub Pages: publish the contents of `dist/` (e.g. with the `actions/deploy-pages` action after `npm ci && npm run build`). For a custom domain nothing needs to change.

Note: IndexedDB is per-origin, so moving to a different URL/domain starts with empty data — export a backup first and import it at the new address.

## Accessibility

Semantic landmarks and skip link, visible focus, keyboard-operable forms and combobox, dialogs via native `<dialog>`, `prefers-reduced-motion` and light/dark support, tap targets ≥ 44px, and meaning is never carried by colour alone (signs, labels, hatching for overspend, text alternatives for charts with companion tables).
