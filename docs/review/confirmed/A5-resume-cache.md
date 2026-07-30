# A5 — Resume parser cache

**Status:** confirmed by execution · **Owner:** fix agent A5
**Files:** `src/utils/resumeParser.js`

## A5.1 — The cache serves the wrong candidate's resume text (Critical)

`resumeParser.js:11` declares a module-level `Map` keyed by **filename alone**. `dir` became a caller-supplied
parameter (`:19`) but never entered the key. The freshness check (`:41-42`) compares only `mtime`.

**Reproduced:**
```
dirA -> "CANDIDATE A TEXT - Java Backend Engineer"
dirB -> "CANDIDATE A TEXT - Java Backend Engineer"
*** WRONG: dirB served dirA text ***
```
Two directories, same filename, identical mtimes — the second call returned the first directory's content.

Identical mtimes are not exotic: `cp -p`, `rsync -a`, `git checkout`, and coarse-granularity filesystems all
produce them.

**Consequence:** the wrong person's resume text is fed into scoring and into tailoring, silently, with no error.

**Fix direction:** key the cache on the resolved absolute path, not the bare filename. While you are there,
assess whether entries for deleted files are ever evicted — if not, say so in your report and fix it only if it
is cheap and safe.

**Acceptance:**
- the reproduction above returns each directory's own text
- a file modified in place (same path, new content, new mtime) returns the new content
- caching still works: parsing the same unchanged file twice does not re-read it (assert via a counter or timing,
  not by inspecting internals if avoidable)
- tests fail against current code

## Rules

- Build fixtures in temp dirs under the OS temp directory. **Never write into the repo's `data/resumes/`.**
- Confirm in your report that `data/resumes/` was untouched.
- Tests under `test/`, `node:test` only, no new dependencies.
- Mutation-check the fix.
- Do not run git commands; do not commit.
