# Unit tests

Plain `node:test` + `node:assert` on the system's Node (18 or later). No packages, no browser, no Home Assistant.

```
node --test engine/_dev/test/        # the engine's tests (about 80, a few seconds)
node --test sites/<site>/checks/     # a site's own tests, if it has any
node --test engine/_dev/test/store.test.mjs
```

A test file is `<what>.test.mjs`. Node 18 runs every `.mjs` in the folder, so `stub.mjs` shows up in the output as a test with nothing in it.

## How a module is imported

The engine can't be imported from `engine/` as it is: `core/units.js` and others import `../home.js`, which only a site
has, and the `.js` files are ES modules with no `package.json` saying so. So the tests import from **a real build**:
`stub.mjs` runs `engine/_dev/assemble.sh` (the same script a deploy and the mock use) for `sites/example` into the
system's temporary folder, next to a one-line `package.json`, and `load('core/store.js')` imports from there. No loader
hook, and what is tested is what is deployed.

- The build is made once per state of the source files and shared by all test files of a run (each test file is its own
  process). Its folder name carries a hash of every file's size and time, so an edit gives a new build; older ones of the
  same site are removed after ten minutes.
- `load(file, site)` takes another site (`'house'`) or the path of a site folder (a test's own copy with `dash/home.js`).
- `override(file, { name: fn })` replaces exports of one module with test doubles, before the first `load()`. The process
  then works in its own copy of the build; the real module stays importable as `<name>.real.js`. This is how the
  connection to Home Assistant is replaced (`actions.test.mjs`, `rooms.test.mjs`): nothing is sent anywhere.

## What `stub.mjs` fakes

Only what importing needs (`window`, `document`, `location`, `navigator`, `addEventListener`) and what the tests drive:

| Export | For |
|---|---|
| `clock` | `performance.now()` stands still; `clock.advance(ms)` moves it (optimistic values expiring, confirm-by-second-tap) |
| `fakeTimeouts()` | from the call on, `setTimeout` runs only when the test's `tick(ms)` passes its time; `restore()` puts the real ones back (the remote's hold, a view's unload) |
| `frames` | `requestAnimationFrame` callbacks wait for `frames.run()` (the store's one-redraw-per-frame batching) |
| `listeners`, `intervals` | how many window / document listeners and intervals are alive (what a view leaves behind) |
| `elem()` | an element that accepts anything; nothing is drawn |

Intervals a module starts when it is imported don't keep node alive. Without `fakeTimeouts()` timers (`setTimeout`) are real: a test that
leaves one running makes the file wait for it.

## A bug that is known and not fixed yet

Write the test for the right behavior and mark it `{ todo: 'what is wrong today, in plain words' }`. The run stays
green and lists it under `# todo`; once the code is fixed the test passes, and the `todo` is removed.

## The site validator

`engine/_dev/tools/check-site.mjs <site>` uses the same build and stub to load a site's `home.js`, pop-ups and every
dashboard, and checks the config against the card modules and an entity list. `check-site.test.mjs` runs it on a copy of
the example site with one mistake of each kind written in.

## Not testable yet

Logic that lives inside a card's default export, or in a module-private function, can't be reached from a test. Such a
function gets a test when it is exported (or moved into a module of its own).
