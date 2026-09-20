# Weekly Budget — Product & Build Specification

**Audience:** Claude Code (implementation guide)  
**Deliverable:** A complete, working, responsive personal expense-tracking website.  
**Stack:** React + Vite + TypeScript.  
**Design direction:** Swiss International Typographic Style — crisp hierarchy, disciplined grid, excellent typography, restrained color, high information density without clutter.

> Build the website, not just a mockup. Favor a polished, dependable personal tool over a bloated finance platform. No paid API, bank connection, AI subscription, or account registration is required for v1.

---

## 1. Product vision

Create a quick, enjoyable way for one person to track day-to-day spending against a **$150 weekly target**, with **Monday–Sunday** budget weeks and **automatic carryover** of unspent money or overspending. The user should be able to open the app, see exactly how much they can spend, record a purchase in seconds, and understand where their money went without wrestling with a spreadsheet.

Core user questions the app must answer:

1. How much money can I spend **right now**?
2. How much can I spend **per remaining day this week** and stay within my available budget?
3. Where did I go, when, and how much did I spend?
4. Which places and categories am I spending the most on?
5. How did going over or under budget last week change this week's starting allowance?
6. Can I add a frequent purchase, e.g. **Bojangles — $15.67**, without typing the details every time?
7. Can I quickly enter variable purchases, e.g. groceries or gas, without accidentally reusing the last amount?

Use the working name **WEEK / WEEKLY** (easy to rename). All copy should be plain English, not accounting jargon.

---

## 2. Budget rules — implement these precisely

### 2.1 Source-of-truth settings

- Weekly base allowance: **$150.00** by default; user editable in Settings.
- Week starts **Monday at 00:00** and ends **Sunday at 23:59:59.999**, in the user's selected local time zone (default browser time zone, persisted).
- All monetary values stored and calculated as **integer cents**, never floating point.
- Every expense belongs to the week of its **transaction date**, not the date it was entered. The app defaults new purchases to today, but allows backdating.
- Expenses decrease the available budget. If refunds are supported, model them explicitly as adjustments/refunds rather than sneaking in negative expenses without explanation.

### 2.2 Carryover equation

For each week `W`:

```text
startingAvailable(W) = baseAllowance(W) + carryoverFromPreviousWeek(W)
spent(W)             = sum of posted expenses dated within W
remaining(W)         = startingAvailable(W) - spent(W)
carryoverToNext(W)   = remaining(W)
```

`baseAllowance(W)` is the allowance effective for that particular week (see setting changes below).

Carryover may be **positive, zero, or negative**. Do not reset to $150 each Monday. Do not silently cap the debt or discard a surplus.

Example:

| Week | Base | Carry in | Available at start | Actual spend | Carry out |
|---|---:|---:|---:|---:|---:|
| Week 1 | $150.00 | $0.00 | $150.00 | $170.00 | -$20.00 |
| Week 2 | $150.00 | -$20.00 | $130.00 | $100.00 | +$30.00 |
| Week 3 | $150.00 | +$30.00 | $180.00 | $0.00 | +$180.00 |

**Important:** carryover is a *cumulative rolling balance*, not just “$150 plus last week's difference from $150.” If a week is missed, its $150 base allowance still exists and rolls forward under this product's default rules. Make this behavior visible to users in the week breakdown rather than surprising them. Settings may offer a future “pause allowance for a week” feature, but do not introduce it silently.

**Negative starting balance:** show that the allowance is already overdrawn. Never render a negative number as a positive “safe to spend” amount.

### 2.3 Starting the tracker / opening balance

On first launch, ask for:

- Base weekly budget, prefilled `$150.00`.
- Tracking start date (default today); the corresponding Monday becomes the **first tracked week**.
- Opening carryover, default `$0.00` (may be positive or negative, if migrating from a spreadsheet).
- Optional choice of time zone, preselected from browser.

**Before the first tracked Monday, do not fabricate prior weeks.** The first week's `startingAvailable = firstWeekBase + openingCarryover`.

### 2.4 Editing history and changing settings

- Deleting, editing, refunding, or backdating a transaction **recalculates that week and all following weeks**. Never hardcode persisted carryover values that can go stale.
- Save budget-setting changes with an **effective Monday**. By default, changing $150 to another amount affects the *next Monday*, not past weeks. Offer a clearly labeled option to affect the current week. Preserve historical weekly base amounts.
- Stable, deterministic results across page refreshes, time-zone boundaries, month/year boundaries, and daylight saving time.
- If the user corrects the tracking start or opening carryover, explain that subsequent historical balances will be recomputed.

### 2.5 Daily spending allowance

On the current week dashboard:

```text
remainingDaysIncludingToday = number of calendar days from today through Sunday, inclusive
suggestedDailyLimit = max(remaining, 0) / remainingDaysIncludingToday
```

Example: Thursday through Sunday = **4 days**, including Thursday. Display money to **two decimal places, rounded down to the nearest cent** so following the suggested daily limit cannot exceed the remaining amount. Consider showing the exact remainder for the last day if rounding leaves a few cents.

If `remaining <= 0`, display **$0.00/day** alongside the overspent amount (not a misleading negative per-day allowance). If someone looks at an earlier week, label it historical and do not show a live “days remaining” projection. If they view a future week, show a forecast explicitly distinguished from actual spending.

Also show a useful explanation: “$88.00 left · 4 days including today · $22.00/day.”

---

## 3. Primary screens and navigation

Keep the main navigation short and consistently visible: **Overview | Transactions | Insights | Settings**. Desktop: horizontal header or slim side rail. Mobile: compact header and accessible bottom navigation or clear menu. Add a prominent, consistent **+ Add expense** action.

### 3.1 Overview (home)

Most important screen. At a glance:

- Current week date range, e.g. **MON 14 SEP — SUN 20 SEP**.
- **Remaining this week** (largest number).
- Base allowance, carryover from last week, this week's starting available, and this week's spending; visually show the equation.
- **Suggested per-day spend for the rest of the week** with “including today.”
- Day-of-week indicator **M T W T F S S**; highlight today's day.
- Simple spend/remaining visualization. For overspending, don't show a progress bar over 100% in a misleading way: use a clearly marked overage state.
- Recent 5–10 transactions; show merchant, category, date and amount, with quick edit/delete.
- Primary Add Expense button and **Quick Add / Frequent Purchases** shortcuts.
- Helpful positive/negative carryover note, e.g. “You brought $24.35 forward from last week” or “You started $18.10 below your usual allowance after last week.”
- Previous / next week arrows and “Today” shortcut to inspect history without changing the active transaction date.

Design for the user's most common flow: **open → check balance → add a purchase → confirm new balance**.

### 3.2 Add expense (modal, sheet, or streamlined page)

Fields:

- Merchant / place / payee (required; free text with suggestions from history).
- Amount (required, positive decimal in dollars, convert to cents on save).
- Date (default today; editable).
- Category (required, with sensible default such as Other, and remembered merchant-to-category suggestions).
- Optional description/notes.
- Optional **Save as frequent purchase** toggle or action, with behavior described in section 4.

Interaction:

- Keyboard friendly, submit with appropriate Enter behavior, clear errors, autofocus first useful field, visible success feedback.
- Add multiple transactions without losing the current screen context.
- Avoid duplicates on fast double-submit (disable saving while saving).
- Clearly distinguish a selected **saved fixed amount** from a **variable merchant suggestion**.

### 3.3 Transactions

Complete searchable transaction ledger:

- Newest first by default; merchant/place, amount, exact local date, category and optional note.
- Search places and notes; filter by date range/week, category, and merchant.
- Sort by date, amount, merchant; show total of filtered expenses.
- Edit, delete with confirmation and an undo opportunity if feasible.
- Separate duplicate purchases are allowed (two legitimate Bojangles visits must not be conflated).
- Allow CSV export and JSON backup (see data safety).
- Grouping by week or day is helpful, but do not sacrifice searchability.

### 3.4 Insights

Use only the user's real data; never fabricate comparisons or trends. Include:

- Weekly history: week starting budget, spent, ending balance, and resulting carryover.
- Category breakdown by selected week / last four weeks / custom date range.
- Merchant spending: total spent at each place, number of visits, average transaction amount, last visited.
- Spend trend by week and a weekday pattern if sufficient data exists.
- Largest purchases and frequently visited places.
- Empty / insufficient-data states that explain what will appear once transactions exist.
- Charts must have accessible labels and companion numeric summaries, not rely on color alone.

### 3.5 Settings

- Weekly budget with effective-week control.
- Opening carryover and tracking start date (with recomputation warning).
- Time zone display and adjustment warning (changing zone may reassign near-midnight transactions to weeks).
- Merchant and category management; rename and merge safely while keeping transaction history intact.
- Frequent purchase management (fixed and variable templates).
- Export CSV / full JSON backup / import JSON backup / clear all data (strong confirmation).
- Local-data/privacy explanation.

---

## 4. Smart frequent purchases — critical differentiator

The app should save time on routine spending **without assuming all visits to a merchant cost the same**.

### 4.1 Two explicitly different shortcut types

**Fixed-price purchase template** (e.g. “Bojangles usual order”):

```text
merchant: Bojangles
label: Usual order
amount: $15.67
category: Dining
kind: fixed
```

Clicking the shortcut pre-fills merchant, amount, and category, opens the add-expense form for review, and saves only when the user confirms (or offers a configurable one-click mode later). A fixed template's amount stays `$15.67` until user edits the template. It **must not drift** merely because one visit costs a different amount.

**Variable-amount merchant template** (e.g. Walmart groceries or a gas station):

```text
merchant: Grocery store
label: Groceries
amount: none
category: Groceries
kind: variable
```

Selecting it pre-fills the merchant and category but **leaves the amount blank**, even if the last grocery trip cost `$82.43`. Display prior amount in secondary helper text only if useful; never accidentally charge it.

Both types should be createable while logging a purchase and editable/deletable from Settings or shortcut menus. A merchant may have **several fixed templates plus one variable shortcut** (e.g. two different restaurant orders).

### 4.2 Suggestions from purchase history

- Autocomplete previously entered merchant names (case-insensitive, normalized for matching but preserve the display spelling).
- Suggest last-used category and the option to save a frequent shortcut after repeated visits.
- Do **not** automatically classify a merchant as fixed simply because two previous amounts match. Ask the user before creating a shortcut, with a simple “Save as fixed $15.67” or “Save as variable amount” choice.
- If a fixed template's purchase is edited to another amount, update that individual transaction only, not the template, unless explicitly asked.
- Do not create fake recurring transactions or deduct any money just because a purchase template exists.

---

## 5. Visual system — Swiss International

Make it feel like a thoughtfully designed financial instrument, not a bank dashboard or generic SaaS template.

- Strong typographic hierarchy with a modern sans (e.g. Inter or a well-chosen system stack), confident large numerals, tabular lining figures for currency.
- Restrained palette: warm off-white or near-white background; near-black text; one decisive accent (e.g. cobalt or vivid red); semantic green/amber/red used only where relevant and not as the sole information channel.
- 8px spacing rhythm; strict column grid; generous whitespace; hairline dividers; carefully aligned numbers and labels.
- Editorial / Swiss touches: small uppercase section labels, tight grid, bold headline metrics, simple geometry, utilitarian buttons.
- Flat surfaces with minimal shadows, subtle borders, minimal or no gradients, tasteful corner radius, no glassmorphism.
- Make the amount remaining unmissable, while the daily limit and add-expense action remain prominent.
- Positive carryover and negative carryover must be intelligible **in text and sign**, not just color.
- Responsive from ~320px mobile through large desktop; comfortable tap targets and forms usable with mobile number keyboards.
- Accessible color contrast, focus states, semantic HTML, keyboard navigation and reduced-motion support.
- User-selectable light/dark mode is optional, not a reason to compromise v1 polish.

---

## 6. Implementation architecture

### 6.1 Preferred approach

Build a **local-first single-user application**, zero-cost to run, with **IndexedDB** for durable structured storage; use **Dexie** (or a similarly maintained IndexedDB wrapper) to simplify queries and migrations. Avoid `localStorage` as the sole database for important transaction history. No account, payment credentials or financial institution API needed.

Suggested packages:

- React, Vite, TypeScript.
- React Router for navigation.
- Dexie + dexie-react-hooks (or equivalent) for reactive local persistence.
- date-fns or Luxon for date math; time-zone-aware library if supporting configurable time zones. Avoid fragile hand-rolled UTC/week calculations.
- Recharts or another accessible chart library, used sparingly.
- Lucide icons or minimal inline SVG.
- CSS Modules or vanilla CSS with design tokens (Tailwind is acceptable if it serves, rather than overrides, the visual direction).
- Vitest and React Testing Library for core logic and interactions.

Use a `src/` structure roughly like:

```text
src/
  app/            routes, shell, global providers
  components/     reusable UI (metric, expense form, weekly strip, charts)
  features/
    budget/       calculations, week selectors, UI
    expenses/     CRUD, merchant suggestions, filters
    templates/    fixed/variable shortcuts
    insights/     groupings and summaries
    settings/     effective budget changes, data tools
  db/             schema, migrations, queries, backup
  lib/            money, dates, validation, formatting
  styles/         tokens, typography, reset, layout
  tests/          financial edge cases and key workflows
```

### 6.2 Suggested domain types

```ts
type Expense = {
  id: string;
  merchantId?: string;
  merchantName: string; // snapshot supports historical readability
  amountCents: number;  // positive integer
  categoryId: string;
  date: string;         // YYYY-MM-DD in the user's budgeting time zone
  note?: string;
  templateId?: string;
  createdAt: string;    // ISO timestamp
  updatedAt: string;    // ISO timestamp
};

type PurchaseTemplate = {
  id: string;
  merchantName: string;
  label: string;
  kind: 'fixed' | 'variable';
  amountCents: number | null; // required iff fixed
  categoryId: string;
  usageCount: number;
  lastUsedAt?: string;
};

type BudgetChange = {
  id: string;
  effectiveWeekStart: string; // Monday YYYY-MM-DD
  baseAllowanceCents: number; // nonnegative integer
};

type BudgetSettings = {
  firstWeekStart: string;
  openingCarryoverCents: number; // signed
  timeZone: string;             // e.g. America/New_York
  currency: 'USD';
};
```

Define Category and optional Merchant tables with stable IDs, user-editable display names, and sensible starter categories: Dining, Groceries, Gas / Transportation, Shopping, Entertainment, Bills, Other. Never force a category just because the merchant suggests one.

### 6.3 Derived budgets, not stored copies

Prefer a pure calculation function over duplicating balances in a table:

```ts
calculateWeekSummary({
  weekStart,
  firstWeekStart,
  openingCarryoverCents,
  budgetChanges,
  expenses,
}): {
  baseCents,
  carryInCents,
  startingAvailableCents,
  spentCents,
  remainingCents,
  carryOutCents
}
```

Derive week summaries sequentially from the first tracked week through the requested week, including intervening weeks with no expenses. For a long history, memoization/caching is fine, but **invalidate every affected later week** on historical edits and budget changes. Pure functions should be thoroughly tested independently of React.

### 6.4 Data integrity & privacy

- Validate all inputs; reject empty merchants, zero/negative expense amounts, malformed dates, NaN, and invalid cents.
- Store dates and currency unambiguously; format display amounts with `Intl.NumberFormat`.
- Guard imports against invalid schemas and duplicate IDs. Make backup import **preview + confirm**, and define replace-vs-merge behavior clearly (v1 can implement replace only).
- JSON backup must preserve settings, budget changes, category definitions, templates, and transactions, with `schemaVersion` and export timestamp.
- CSV is for readable transaction export (not necessarily lossless restore). Explain this distinction.
- IndexedDB is device/browser/profile-specific; a static hosting URL **does not automatically sync across devices**. Explain this in Settings and gently encourage backups. Do not imply data is on the cloud.
- No analytics, third-party tracking or secret keys necessary. Avoid printing transaction details in production console logs.
- If developing a mobile-installable PWA, treat it as an enhancement; offline use is useful, but data durability/backup matters more.

---

## 7. Detailed interaction examples

**Example A — overspend:** Start week with $150. Add $15.67 Bojangles, $65 groceries, $80 gas. Spent = $160.67, remaining = -$10.67. Next Monday begins at `$139.33`, assuming $150 base and no other entries.

**Example B — underspend:** Next week, spend $100. Remaining = `$39.33`; subsequent Monday begins at `$189.33`.

**Example C — daily target:** On a Thursday, remaining `$88.00`. Thursday/Friday/Saturday/Sunday are four calendar days, so display `$22.00/day`. A purchase made that Thursday immediately updates remaining and the figure; the day count remains four until local midnight.

**Example D — saved restaurant order:** Create fixed Bojangles shortcut `$15.67`. Reusing it should require very few taps and show `$15.67`. If an order is `$17.00` one time, modify the pending purchase to `$17.00` and keep the saved shortcut `$15.67`.

**Example E — variable groceries:** Select saved grocery shortcut; merchant/category appear, amount is empty and required before save. The previous grocery price is never silently copied.

**Example F — backdated edit:** On Tuesday, correct a purchase from two weeks ago from `$18.00` to `$28.00`. The intervening and current weeks should each show `$10.00` less remaining, all else equal.

**Example G — no purchases:** A zero-spend week still adds the weekly allowance and carries the entire starting available balance forward.

---

## 8. Acceptance criteria and required automated tests

Do not consider the project complete until these pass:

1. Fresh start defaults to `$150`, correct local Monday, opening carryover `$0`.
2. Monday–Sunday assignment works for Sunday night, Monday morning, end of month/year, and daylight-saving transitions.
3. Positive and negative carryovers work over **3+ consecutive weeks**, including a skipped no-spend week.
4. Overbudget amounts never appear as spendable cash or a negative “daily safe spend.”
5. Daily target **includes today**, updates after adding/editing/deleting purchases, and rounds down safely.
6. Editing an earlier purchase recalculates every following week; deleting also reverses it.
7. A historical budget change does not retroactively overwrite preceding weeks; effective-date behavior is explicit.
8. Saving a fixed purchase retains its template amount when an individual transaction is changed.
9. Variable purchase shortcut leaves the amount blank even after repeated visits.
10. Two purchases with the same merchant/date/amount are both preserved unless the user explicitly deletes one.
11. All transaction data and settings survive refresh and browser restart in the same browser profile.
12. JSON export/import restores exact ledger and settings after validation; invalid imports do not corrupt current data.
13. Mobile layouts have no horizontal overflow or inaccessible controls; forms and charts have usable accessible labels.
14. Empty state, no remaining budget state, unusual large carryover and zero-history insights look intentionally designed.

---

## 9. Suggested build order for Claude Code

**Phase 1 — foundation:** Scaffold Vite/React/TS, set up routes, type system, styling tokens, database schema/migrations, money/date utilities, and budget calculation tests.

**Phase 2 — working tracker:** Onboarding, weekly Overview, Add Expense form, ledger, editing/deleting, carryover calculation, and per-day spending target. Confirm examples A–G by test and by clicking through the app.

**Phase 3 — fast logging:** Fixed and variable templates, autocomplete, merchant/category suggestions, quick-add UI, and template management.

**Phase 4 — history & insights:** Weekly navigation, filters/search, merchant/category aggregation, lightweight charts and useful empty states.

**Phase 5 — production polish:** Responsive Swiss-style design, accessibility, JSON backup/import, CSV export, data safety messaging, comprehensive tests and deployment instructions.

### Developer expectations

- Create the actual source code, not pseudocode; choose and document any reasonable implementation detail not prescribed here.
- Do not build login, shared budgets, subscriptions, bank integrations or automatic purchase deductions in v1.
- Provide a `README.md` with setup, `npm install`, `npm run dev`, `npm run build`, `npm run test`, storage/backup explanation and static deployment notes.
- Ensure production build succeeds; fix TypeScript and test failures before declaring completion.
- Support static hosting (e.g. GitHub Pages or a static site) with correct SPA routing/base path configuration when chosen. If deploying to a custom domain, configure Vite `base` appropriately.
- Prioritize correct money math, near-zero-friction entry, and a refined Overview over optional gimmicks.

**Definition of done:** The owner can log a Bojangles purchase in seconds, add groceries at a different amount each time, move between Monday–Sunday weeks, see exactly what carries forward, and trust the remaining and daily allowance figures after editing old purchases.
