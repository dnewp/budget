# Envelope (personal budget app)

YNAB-style envelope budgeting for a single user. Local hosting for now; will move to the home webhost server later (copy the folder plus `data/budget.db`, run `npm run build` then `npm start`).

## Stack

- React 19 + Vite + Tailwind frontend in `src/`
- Express 5 backend in `server/`, listening on :4517
- SQLite via built-in `node:sqlite` (no native deps); db file at `data/budget.db`, migrations keyed off `PRAGMA user_version` in `server/db.js`
- **Frontend changes hot-reload; anything in `server/` does not.** Editing a route or the envelope math needs the process restarted, otherwise the API quietly keeps serving the old code and the change looks like it silently failed.
- Dev: `npm run dev` starts one process on http://localhost:4517. The `--dev` flag makes Express mount Vite in middleware mode, so there is no second port, no proxy, and a leftover `dist/` never shadows dev.
- Prod: `npm run build` then `npm start` (same port, Express serves `dist/` instead of Vite)
- `HOST` and `PORT` are environment overrides, defaulting to `0.0.0.0:4517`. Behind a tunnel set `HOST=127.0.0.1` so only cloudflared on the same box can reach the app; the systemd unit in `deploy/` does this.
- **The server needs Node 22.5+ and really wants 24**, because `node:sqlite` does not exist in older releases. Ubuntu's own `nodejs` package is far too old. See `deploy/README.md`.
- Tests: `npm test`. Target `server/*.test.js` explicitly, never the whole `server/` directory, because a directory run executes `index.js` and hangs on the listening server.

## Auth

Single password. `npm run set-password -- <password>` writes a scrypt hash and `SESSION_SECRET` to `.env`. The session cookie is a stateless HMAC under `SESSION_SECRET`; rotating the secret signs out everywhere. `/api/*` requires the cookie except `/api/login`.

`sessionCookie()` in `server/auth.js` builds the cookie and always sets `HttpOnly`, `SameSite=Lax` and `Path=/`. **`Secure` is added only when the request is genuinely over HTTPS**, meaning `req.secure` or a leading `x-forwarded-proto: https` from a tunnel or proxy that terminated TLS for us. Setting `Secure` unconditionally would stop the browser returning the cookie over plain HTTP, which presents as being unable to sign in on localhost and is confusing to diagnose. `server/auth.test.js` pins all of this down.

## Money and budgeting rules

- All amounts are integer cents. Floats never touch money.
- Activity and Available are always derived from transactions and allocations, never stored.
- Available carries negative balances forward (simpler than YNAB's reset-and-dock rule; upgrade only if it annoys).
- Ready to Assign = inflows to budget accounts minus total ever assigned.

## Splits

A split transaction is several `transactions` rows sharing one `split_group`, not a parent row with children. That is deliberate: the envelope math, account balances, and activity totals all keep working with no special cases, because each line is an ordinary transaction. The register groups rows by `split_group` for display in `groupTransactions` (`src/pages/Accounts.jsx`).

The server rejects a split whose lines do not sum to the transaction total, and the form blocks saving before that. Both checks matter: the UI one is the fast feedback, the server one is the guarantee. Editing a split deletes the whole group and reinserts it, so lines can be added or removed without row-by-row reconciliation.

## Targets, and why funded is not the same as assigned

Each envelope has a `target_cents` goal, 0 meaning none, plus a `target_period`. `target_cents` is always the REAL full bill, never one person's share of it. Four periods exist:

- `monthly`, `quarterly`, `yearly` are **bills**, saved for in instalments. `monthlyNeed()` divides the bill by 1, 3 or 12, rounding up so instalments never fall a cent short. A $90 quarterly bill asks $30 a month and holds enough by the time the bill lands. Carry-forward Available does the accumulating, which is why no sinking-fund machinery exists.
- `balance` is a **bucket**, not a bill: an envelope that should always hold a float. Home Maintenance keeps $1,000; spend $185 and it immediately asks for $185 back. Its need is `target - available`, measured against the envelope rather than the month.

`needed_cents` is what an envelope still wants this month and already accounts for the difference between the two kinds, so the UI and fill-targets both use it and neither branches on period.

Deliberately absent: which specific month a non-monthly bill is due. Spreading evenly means the money is simply there whenever it arrives, so due dates would be state to maintain for no benefit. YNAB also has by-date and spending targets; add more only when asked.

## Average spent

`average_spent_cents` is what an envelope actually costs in a typical month: total outflows divided by the number of months spanned since its first transaction, **including months with no spending**, or a bill that lands every other month would read at twice its real cost. Inflows are excluded, so a housemate's contribution never flatters the number. It is null until two months exist, because one month is not an average.

This exists for seasonal bills. Power, gas and water swing with the weather, so the envelope is funded at a flat monthly amount, builds up in mild months, and drains in extreme ones. The average is the feedback that tells you whether the flat amount is right: funding water at $100 while averaging $132 means the envelope trends negative and the target needs raising.

Money reaches an envelope two ways, and a target counts both:

- **assigned** from Ready to Assign, via `allocations`
- **inflow**, a positive transaction categorized straight into the envelope

`funded_cents = assigned_cents + inflow_cents`, and progress toward a target is always measured against `funded_cents` versus `monthly_need_cents`, never against `assigned_cents` or the raw `target_cents`. This exists for bills that housemates part-fund by sending money through a payment app. The envelope keeps the real full bill as its target, their money is paid directly in, and only the remainder needs assigning. Measuring against assigned alone would wrongly demand the full amount every month. `POST /budget/:month/fill-targets` respects this and assigns only `target - inflow`, and never claws money back.

Follow the same rule for any bill somebody else part-funds: keep the true bill as the target and pay their share into the envelope.

`payees` stores regular vendors with `last_category_id`, so picking a payee prefills its usual envelope. Saving a transaction records the payee automatically. `server/seed.js` seeded the initial set from a first pass over real bank exports.

## Food envelopes

Food is split three ways on purpose, because lunch at work and going out are different habits with different fixes: Groceries, Work Lunch (the regular weekday habit plus fast food), Going Out (sit-down places, bars, breweries), and Work Vending (the office market). Targets came from June and July 2026, the only two months in the source data with no travel skewing them. Keep new food payees routed to the right one of these rather than adding a general dining envelope.

Note that banks miscategorize badly: subscriptions routinely arrive tagged "Restaurants/Dining", and petrol stations arrive tagged "Groceries" when they are mostly fuel. Never trust the bank's category column.

## Mobile

Managing transactions on the go is the point of the phone layout, not an afterthought, so:

- **The floating + button** (`QuickAdd` in `ui.jsx`) is the primary action on phones, pinned bottom right in the thumb zone. The header "Add transaction" button is `hidden md:block` because a header button is unreachable one-handed. Keep it that way.
- **The shell is exactly one viewport tall and never scrolls; `<main>` scrolls inside it.** The tab bar is a normal flex child, NOT `position: fixed`. A fixed bottom bar gets stranded off screen on iOS when the Safari toolbar collapses mid-scroll, which made the tabs vanish and not reliably come back. Do not "simplify" the tab bar back to fixed.
- **`env(safe-area-inset-bottom)`** pads the bottom nav and offsets the floating button, so neither sits under the home indicator. `viewport-fit=cover` in the meta viewport is what makes those insets non-zero.
- **`appearance: none` on every select and date input**, set globally in `index.css`. iOS otherwise applies native chrome that ignores our padding and height, so a select renders shorter than the text input beside it and the row looks crooked. `selectClass` adds the dropdown arrow back as a background image, since removing the appearance removes the arrow too. Use `selectClass` for selects and `inputClass` for everything else; a select on bare `inputClass` will have no arrow.
- **Grid and flex cells holding an `<input type="date">` need `min-w-0`.** iOS reports a wide intrinsic size for date inputs, and a grid item's default `min-width: auto` lets that overflow the track and shove the neighbouring field out of alignment.
- **`PayeeInput` is deliberately not a `<datalist>`.** Support is patchy on iOS Safari, which is the one browser this matters most in, and the native dropdown gives tiny tap targets. The custom list gives 48px rows and works everywhere. Do not "simplify" it back to a datalist.
- Inputs must stay at 16px or larger, or iOS zooms the page on focus.
- The app is installable: `public/manifest.webmanifest` plus the apple-touch-icon make Add to Home Screen open it standalone with no browser chrome. `icon.svg` is the source of truth; `icon-192.png` was rendered from it and needs regenerating if the SVG changes.

## Emoji picker

The envelope edit panel offers emoji suggestions rather than relying on the OS picker. `EMOJI_HINTS` in `src/pages/Budget.jsx` maps name patterns to emoji, and matches are shown first as the name is typed, followed by `COMMON_EMOJI`. Typing "Motorcycle" surfaces 🏍️ 🛵 🪖 ahead of the generic set. Add a pattern when a new envelope kind has an obvious icon; the OS picker still works in the icon box for anything unlisted.

## Seeding

`npm run seed` creates the envelope structure, payees, and accounts. It refuses to run if any category already exists, so it cannot duplicate them. Re-seeding from scratch means deleting `data/budget.db` first.

## Project rules (standing)

- Update THIS file in the same change as any scope, behavior, or architecture shift.
- No em-dashes anywhere: code, comments, docs, UI copy, commit messages.
- Emojis appear in exactly one place: an optional per-envelope (category) icon, always rendered on the LEFT of the envelope name, never the right. Nowhere else, ever.
- Single-line commit messages.

## Layout of the code

- `server/budget.js` holds the envelope math as pure functions over plain rows, so the tests cover the rules without a database. Any change to how Available, Ready to Assign, targets or averages work belongs there, with a test.
- `server/routes.js` is all HTTP: validation helpers at the top (`cents`, `text`, `isoDate`, `monthParam`, `period`, `emoji`), then accounts, transactions, categories, budget, reconcile. Validators throw `HttpError`; the handler in `index.js` turns those into JSON.
- `src/pages/` has one file per screen (Budget, Transactions, Accounts, Login). `src/components/` holds the shared pieces: `Money`, `parseAmount`, `Register` with `groupTransactions`, `TransactionModal`, `ReconcileModal`, and the `Button`/`Field`/`Modal`/`inputClass` primitives. Budget, Transactions and Accounts all render the same `Register` and the same `TransactionModal`, so fix register or entry bugs once, in the component.

### inputClass already sets a width

`inputClass` includes `w-full`. Never append another width or flex class to it (`w-24`, `flex-1`), because Tailwind does not resolve the conflict and whichever rule comes later in the stylesheet wins, which once collapsed the split editor's envelope dropdown to nothing. Put the width on a wrapper `div` instead, with `min-w-0` on any flex child that must be allowed to shrink.

## Reconciling

Modelled on YNAB, deliberately.

- **Cleared** (`transactions.cleared`) means the bank has finished processing it. Toggled from the register with the C button. A split clears as a whole, never line by line.
- **Cleared balance** is the sum of cleared transactions and is the ONLY thing compared against the bank. Comparing the working balance would fail every time something had not landed yet.
- **Reconciled** (`transactions.reconciled`) means locked. `PUT` and `DELETE` on a locked transaction are refused with 409, as is toggling its cleared flag. Undo the month's reconcile first.

`POST /reconcile/:month/:accountId` compares the cleared balance through that month against the real bank balance. A mismatch is refused with **409** and the difference; it only goes through with `force: true`, which writes a visible "Reconciliation Balance Adjustment" transaction dated the last day of the month and records it in `reconciliations.adjustment_cents`. That asymmetry is the point: the easy path is finding the missing transaction, and fudging is always deliberate and always leaves a trace. Never make force the default or hide the adjustment.

`DELETE /reconcile/:month/:accountId` unlocks the month. It deliberately leaves any adjustment transaction in place, since removing it would silently move the balance; it is an ordinary transaction you can delete yourself.

**Only cash accounts are reconciled** (`type != 'credit'`), by choice: you check that what went in and out of checking matches what you recorded and that the closing balance matches the bank's website. Card balances are maintained from transactions and manual edits instead, so reconciling never becomes a five-account chore. This is the one intentional divergence from YNAB, which reconciles cards too.

## Debt view

`server/debt.js` holds the payoff maths as pure functions, tested in `server/debt.test.js` against known values: computed monthly interest must be right, or the projections are fiction. Rates live in `accounts.apr_bp` as basis points (1649 = 16.49%), null when unknown and then treated as 0% rather than guessed.

`accounts.payment_category_id` links a card to the envelope that pays it, so the projection reads the real budgeted payment rather than storing a second copy that drifts. Change an envelope's target and the payoff updates by itself.

Two rules the maths depends on:

- A payment at or below the monthly interest returns `null` from `payoffMonths`, because the balance never falls. Show it as "never at this payment"; do not paper over it with a big number.
- A payment barely above the interest is finite but absurd, so `HOPELESS_MONTHS` (600) is the threshold past which the UI says "decades" instead of printing 1,063 months.

**Cards are not tracked transaction by transaction.** You update each statement balance once a month from the Debt tab's "Update balances" form, and the difference is written as a "Statement balance" adjustment. That was a deliberate choice over recording every purchase and interest charge: the statement balance is the truth either way, and recording payments while forgetting interest would flatter the projection. Do not build card transaction entry back in unless asked.

`GET /debt` sorts by **total interest paid, not by rate.** The lowest-APR card can easily be the most expensive one, because a payment that barely clears the monthly interest leaves almost nothing going to principal and drags on for years. Ranking by rate would hide the single most useful fact in the whole app. Keep that ordering.

## Payment Plans are not debt

Installment plans (Affirm-style 0% financing on a specific purchase) live in their own **Payment Plans** group, never in Debt Payments. They cost nothing, they end on a known date, and grouping them with revolving card debt misrepresents both. They also never appear in the Debt view, because that reads credit-type *accounts* and these exist only as envelopes.

Route each payment to the envelope for whatever was bought as it comes in, rather than keeping a permanent installment-plan line, so expect those envelopes to shrink and eventually be hidden.

## Hiding envelopes

There is no delete, only `categories.hidden`, so an envelope's transactions always keep their category and history never breaks.

Hiding one that still has money in it is refused with **409** and the `available_cents` it holds. Passing `release: true` subtracts that leftover from the month's assignment before hiding, which is what returns the money to Ready to Assign; an overspent envelope hands its shortfall back the same way rather than burying it. Without this, hidden envelopes stayed counted in `everAssigned` while being invisible, so the money was stranded with no way to reclaim it. `server/hide.test.js` covers both directions.

`GET /categories?hidden=1` lists hidden envelopes, and the Budget page shows a "Show N hidden envelopes" disclosure with Bring back, so hiding is never one-way.

## Account balances

A balance is never stored, only ever the sum of an account's transactions. `PATCH /accounts/:id` with `balance_cents` writes the difference as a visible "Balance adjustment" transaction, so the register still adds up and every correction is findable.

**Credit accounts are excluded from Ready to Assign.** Ready to Assign means spendable cash, and a card balance is debt. Without this, entering a card's real balance would read as losing that much money today and wreck the budget. Card purchases still hit their envelopes normally because those carry a category. See `server/credit.test.js`.

## Not built yet (deliberately)

CSV import, receipt-photo parsing, a move-money-between-envelopes popover, spending reports, and envelope reordering within a group. Envelopes can be renamed, retargeted, moved between groups, and hidden, but never deleted.

## Design direction

One committed light theme. Palette: paper `#F7F8F6`, ink `#1B2733`, spruce `#1E5C4A` primary, brick `#B3382C` for overspent, mist `#DCE2DD` borders (tokens in `tailwind.config.js`). Type: Bricolage Grotesque display, Instrument Sans UI, Spline Sans Mono for every money amount. Signature element: the Ready to Assign banner is a receipt strip with a perforated tear-off edge (`.receipt-edge` in `src/index.css`). Desktop gets a sidebar, phones get a bottom tab bar; the whole app must stay usable at 375px wide.
