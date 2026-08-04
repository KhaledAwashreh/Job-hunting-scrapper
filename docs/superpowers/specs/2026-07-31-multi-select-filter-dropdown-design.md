# Multi-select searchable filter dropdown — design

## Problem

The Companies tab's country filter is a grid of independent checkboxes — with
~195 countries in `/countries.json`, this means scrolling a long list to find
one. Separately, the Positions tab has six filters (Country, Status, Job Type
×2, Location Type, Level), all native single-value `<select>` elements, so a
user can only ever filter by one country / one job type / one level at a
time even though positions can genuinely have multiple location types or
seniority levels.

This design replaces both with one reusable multi-select dropdown component
that has a search box, and applies it everywhere a categorical filter
currently forces either "scroll a long checkbox list" or "pick only one
value."

## Scope

**In scope:**
- A new, generic `MultiSelectDropdown` component (`public/components/multi-select-dropdown.js`).
- Companies tab: country filter (`companies-countries.js`) migrated from a
  checkbox grid to the new component. Matching logic (`countryTokenMatch`,
  free-text vs. ISO-code resolution from issue #13) is unchanged — only the
  rendering/interaction layer changes.
- Positions tab (`positions-tab.js`, `dashboard.html`): Country, Job Type,
  Location Type, and Level filters migrated to the new component.
- Consolidating the Positions tab's two existing Job Type filters
  (`#jobTypeFilter` top bar, `#filterJobType` second row — pre-existing
  duplication, confirmed with the repo owner) into one multi-select filter.
- e2e test updates/additions and snapshot re-baselines for all of the above.

**Out of scope:**
- Positions tab Status filter (`#statusFilter`) — stays a native single-select
  (4 fixed values, no search/scroll problem to solve).
- Any server-side / API changes — filtering stays entirely client-side, as it
  is today.
- Any new npm dependency or build step — this is a plain-script browser app;
  the new component follows that same convention.

## Component: `MultiSelectDropdown`

### API

```js
const instance = MultiSelectDropdown.create({
  containerId: 'countriesContainer',   // element the component renders into
  placeholder: 'All Countries',        // shown when selection is empty
  options: [{ value, label }, ...],
  selected: new Set(['IE', 'NL']),     // initial selection (by value)
  onChange: (selectedSet) => { ... },  // fired on every toggle/select-all/clear-all
});

instance.setOptions(newOptions);       // re-render with a new option list (values re-populate as data changes)
instance.getSelected();                // -> Set<string>
instance.destroy();                    // remove listeners/DOM
```

The component knows nothing about companies, positions, countries, job
types, etc. — it only deals in `{value, label}` pairs and a selection `Set`.
Each call site owns its own data and re-filters/re-renders in its `onChange`
callback, the same way today's `checkbox.addEventListener('change', ...)` and
`select.addEventListener('change', ...)` handlers do.

### Rendering

**Closed state:** a `<button type="button">` toggle showing the `placeholder`
text when selection is empty, or `"N selected"` when not — matching the
existing "Selected: N" label convention already used for the countries
filter.

**Open state:** clicking the toggle (or Enter/Space while it's focused) opens
a panel anchored directly below it, containing, top to bottom:
1. A text `<input>` search box — filters the option list by case-insensitive
   substring match against `label`, live as the user types.
2. "Select All" / "Clear All" text-button links — operate on the
   *currently-filtered* (searched) subset, matching the mental model of
   "select all of what I'm looking at," and kept in every instance for
   consistency even on short lists (e.g. Level).
3. A scrollable list of checkbox rows (reusing the existing `.country-row`
   label/checkbox markup), `max-height` + `overflow-y: auto` so it never
   grows past a fixed viewport height regardless of list length.

Every checkbox toggle re-renders the "N selected" count and calls `onChange`
immediately — there is no "Apply" button, matching the live-filter behavior
already present everywhere else in this app.

### Keyboard & accessibility

- Toggle button: `aria-haspopup="listbox"`, `aria-expanded` kept in sync,
  `aria-controls` pointing at the panel — the same pattern this codebase
  already established for the accordion header in issue #15.
- `Escape` closes the panel and returns focus to the toggle button.
- Clicking anywhere outside the open panel closes it.
- Tab order: toggle button → search input → checkbox rows (native tab order
  within the list) → Select All/Clear All are reachable via Tab as regular
  buttons.

### Styling

New CSS added to `public/styles.css`, using the existing `--color-*` custom
properties already defined there (no new palette). Layout: the toggle is an
inline-block button of a fixed min-width; the panel is `position: absolute`,
anchored to the toggle, with the option list capped at a fixed max-height.

## Integration points

### Companies tab — country filter

`companies-countries.js`: `renderCountryCheckboxes()` (and the
select-all/clear-all/updateCount logic it currently wires up) is replaced by
one `MultiSelectDropdown.create(...)` call mounted into the existing
`#countriesContainer` div. The instance's `onChange` sets
`this.selectedCountries` and calls the existing `filterCompaniesByCountry()`.
`countryTokenMatch`/`wholeTokenIncludes` and the ISO-code-to-display-name
resolution are unchanged.

### Positions tab

**Correction from the original draft:** Country is *not* client-side-filtered
today the way Job Type/Location/Level are — `loadPositions()` currently sends
the selected country as a `?country=` query param and the server (via
`getPositionsByFilters`) narrows the result set before it ever reaches the
browser. Only `Status` (untouched by this change) stays server-filtered.
Country moves to client-side filtering as part of this change, confirmed
with the repo owner: no server/API change, `country` is dropped from the
query string entirely, and Country becomes a filter predicate over the
already-loaded `this.positions` list, exactly like the other three.

`dashboard.html`: the `<select>` elements for `#countryFilter`,
`#filterLocation`, `#filterLevel` are replaced with empty mount `<div>`s; the
top-bar `#jobTypeFilter` `<select>` is removed entirely; `#filterJobType`'s
`<select>` becomes a mount `<div>` too (now the one and only Job Type
filter). `#statusFilter` is untouched.

`positions-tab.js`:
- `filterJobType`, `filterLocation`, `filterLevel` become `Set<string>`
  instead of `string|null`; a new `filterCountry` `Set<string>` is added
  alongside them (replacing the direct DOM read of `#countryFilter.value`
  in `loadPositions()`).
- `loadPositions()` no longer reads `#countryFilter` or sets a `country`
  query param — only `status` is sent to the server now.
- The `renderPositions()` filter predicate changes from equality/`.includes()`
  checks against a single value to "selection is empty, or there's an
  overlap between the position's value(s) and the selected set":
  - **Country, Job Type** (single value per position): position matches if
    its value is a member of the selected set.
  - **Location Type, Level** (already arrays per position via `parseArray`):
    position matches if any of its values is a member of the selected set.
- `updateCountryFilter()`, `updateFilterLocation()`, `updateFilterLevel()`,
  and the consolidated Job Type populator all change from building
  `<option>` elements to calling `instance.setOptions(...)` on their
  respective `MultiSelectDropdown` instance, keeping the existing
  "recompute the distinct value list from `this.positions` on every load"
  behavior.

## Testing

This repo has no frontend unit tests — all frontend behavior is covered by
Playwright e2e tests (`test/e2e/*.e2e.js`), so that's what's extended:

- **Update existing tests** for the new markup/selectors:
  `companies-country-filter.e2e.js`, `positions-filters.e2e.js`,
  `positions-listener-leak.e2e.js`. The latter's second test currently proves
  the request-sequencing guard by racing two *server* responses keyed by the
  `country` query param — since Country moves client-side and no longer
  triggers a fetch, that test is rewritten to race two `status` changes
  instead (the guard itself is unchanged, only what triggers a fetch is).
- **New coverage:**
  - Search narrows the visible option list (by label substring, case-insensitive).
  - Select All / Clear All operate on the filtered (searched) subset, not the full list.
  - Multi-select OR-filtering produces the correct result set for each of the
    four converted Positions filters, including the array-valued ones
    (Location Type, Level) where a position matches on overlap.
  - The consolidated Job Type filter reproduces the union behavior of the two
    filters it replaces.
  - Keyboard flow: Tab reaches the toggle, Enter/Space opens it, Escape closes
    it and returns focus to the toggle, and clicking outside closes it.
- **Re-baseline** `test/e2e/__snapshots__/positions.snapshot.txt` and
  `profiles.snapshot.txt` (if profile-tab markup is incidentally affected via
  shared CSS) with `UPDATE_SNAPSHOTS=1` once the new markup is in place.

## Non-goals / explicitly deferred

- No change to how country matching handles free text vs. ISO codes (#13's
  fix stays exactly as-is).
- No persistence of filter selections across page reloads — matches current
  behavior (filters reset on refresh today).
- No server-side filtering/pagination — the full dataset is still fetched and
  filtered client-side, as today.
