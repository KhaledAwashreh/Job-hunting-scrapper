# A6 — Positions table double-parses arrays

**Status:** confirmed by execution · **Owner:** fix agent A6
**Files:** `public/components/positions-tab.js`

## A6.1 — Location and Level always render "—" (Medium, but pervasive)

`positions-tab.js` calls `this.parseArray(pos.location_type)` and `parseArray(pos.seniority_level)` (used at
`:106-107` for filtering and `:116-117` for rendering). Those values arrive from the API as **real arrays** —
`src/db/queries.js` already runs `ensureArray()` on them in `getAllPositions` / `getPositionsByFilters`.

`JSON.parse` on an array stringifies it first, producing `Remote` (unquoted), which is invalid JSON, so it
throws and the `catch` returns `[]`.

**Reproduced:**
```
API returns a real array: ["Remote"]
parseArray(["Remote"]) -> []
```

Two consequences:
1. The **Location** and **Level** columns render `—` for every row, regardless of data.
2. The client-side filters that use `parseArray` (`filterLocation`, `filterLevel`) can never match anything.

The existing E2E missed this because it only forbids the literal strings `undefined`/`NaN`/`null`/`[object Object]`
— and `—` is none of those.

**Fix direction:** make `parseArray` tolerate a value that is already an array. Do not change the server: the
server's shape is the correct one, and `getPositionsForProfile` returning raw strings is a separate, unconfirmed
finding that is **out of scope here** — do not touch it.

**Acceptance:**
- `parseArray(["Remote"])` returns `["Remote"]`
- `parseArray('["Remote"]')` still returns `["Remote"]` (legacy string form)
- `parseArray(null)`, `parseArray(undefined)`, `parseArray('')`, `parseArray('garbage')` all return `[]`
- an E2E assertion proves the Location and Level columns render real values for seeded data
- tests fail against current code

## Rules

- `test/e2e/` has a working harness and seeded fixtures — extend those rather than inventing a new setup.
  Note the seed sets `location_type: ['Remote']` and `seniority_level: ['Mid']`.
- The four tab snapshots in `test/e2e/__snapshots__/` are structure-only (text is stripped), so a text change
  should NOT move them. If a snapshot does change, stop and explain why before re-baselining.
- Never touch `jobs.db`. Do not run git commands; do not commit.
