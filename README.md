# Envelope

A self-hosted envelope budgeting app, in the spirit of YNAB. Every dollar gets a
job before it gets spent.

Single user, runs on your own machine, and all data stays in one SQLite file you
can copy or back up yourself.

## What it does

- **Envelopes** grouped how you like, each with an optional emoji icon
- **Targets** in four shapes: every month, every 3 months, once a year, or keep a
  balance. Non-monthly bills are saved for in instalments so the money is already
  there when the bill lands
- **Split transactions** across several envelopes, with the lines required to add
  up to the total before saving
- **Shared bills**: keep the real full bill as the target and let someone pay
  their share straight into the envelope
- **Reconciling** against your bank's cleared balance, which refuses to pass on a
  mismatch unless you deliberately override it, and locks what it has proven
- **Debt projections**: payoff dates and total interest per card, ranked by what
  each actually costs rather than by rate
- Works on a phone, since it is just a responsive web page

## Running it

```bash
npm install
npm run set-password -- your-password
npm run seed        # optional starter envelopes, accounts and payees
npm run dev         # http://localhost:4517
```

For a long-lived install:

```bash
npm run build
npm start
```

Tests:

```bash
npm test
```

## How it is built

React and Vite on the front, Express on the back, and SQLite through Node's
built-in `node:sqlite`, so there is nothing to compile. In development Express
mounts Vite as middleware, which means one process and one port.

Money is integer cents everywhere. Balances, activity and available amounts are
always derived from transactions rather than stored, so nothing can drift out of
agreement with the ledger.

`CLAUDE.md` explains the design decisions and the reasoning behind the ones that
look unusual.

## Your data

`data/` and `.env` are gitignored. The database holds every transaction and
balance; `.env` holds your password hash and session secret. Neither belongs in
version control. Back up `data/budget.db` and you have backed up everything.
