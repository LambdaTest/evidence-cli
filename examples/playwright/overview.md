# Example: a Playwright pack with a failed assertion

This directory holds a **real `.evidence` pack produced from a Playwright run**
(`playwright.evidence/`, and sealed as `sealed/playwright.evidence`), the
Playwright project that produced it (`project/`), and this walkthrough.

The [kane-cli example](../kane-cli/overview.md) shows a clean run. This one shows
what a **failure** looks like in a pack: one test passes, and one fails on an
`expect(...).toHaveText(...)` assertion because the product is wrong.

**[Open this pack in the viewer ↗](https://evidence.lambdatest.com/?pack=https%3A%2F%2Fraw.githubusercontent.com%2FLambdaTest%2Fevidence-cli%2Fmain%2Fexamples%2Fplaywright%2Fsealed%2Fplaywright.evidence)**
GitHub serves the sealed file with Range support, so the viewer reads it in place.

## The run

Two specs against a small demo cart page (`project/app/index.html`), served by
`page.route` so the run needs no network:

| Test | Verdict | |
| --- | --- | --- |
| `cart-total.spec.ts` › cart shows the subtotal of every line | `passed` | the total is `$49.99` |
| `promo-code.spec.ts` › SAVE10 takes 10% off the cart total | **`failed`** | expected `$44.99`, received `$47.49` |

The page has a deliberate bug: the `SAVE10` promo takes 10% off the **first line
only** instead of the subtotal. Playwright reports it like this:

```
Error: expect(locator).toHaveText(expected) failed

Locator:  getByTestId('cart-total')
Expected: "$44.99"
Received: "$47.49"
Timeout:  2000ms
```

Playwright 1.63.0, Chromium, `retries: 0`, `screenshot: 'on'`.

## The pack

```
playwright.evidence/
  run.yaml                                  # L0 — producer: playwright 1.63.0; totals: 2 tests, 1 passed, 1 failed
  coverage/.keep                            # L1 — global coverage/ dir
  failure.yaml                              # L1 — finalize-generated failure index: one untriaged failure
  tests/cart-total-cart-shows-the-subtotal-of-every-line/
    cart-total.spec.ts                      # L0 — the definition: the spec file itself, opaque and hashed
    result.yaml                             # L0 — status: passed, 3 steps (one per test.step)
    logs/meta.yaml  playwright-result.json  # L1 — this test's slice of Playwright's JSON report
    steps/3-total-equals-the-sum-of-the-lines/screenshot.png
  tests/promo-code-save10-takes-10-off-the-cart-total/
    promo-code.spec.ts                      # L0 — the definition
    result.yaml                             # L0 — status: failed; step 3 carries kind/defect/expected/actual/check
    logs/meta.yaml  playwright-result.json  error.log
    steps/3-total-is-10-off-the-49-99-subtotal/
      failure.yaml                          # L1 — why the step failed: error, locator, source, snippet, page state
      screenshot.png                        #      the frame Playwright took on failure (shows $47.49)
      error-context.md                      #      Playwright's page snapshot at failure, referenced as page_state.a11y
```

It validates at both profiles with no warnings:

```bash
evidence validate examples/playwright/playwright.evidence --profile L1   # → ok valid
evidence validate examples/playwright/playwright.evidence --profile L0   # → ok valid
```

### How a failed assertion is recorded

There are three layers, from the shortest summary to the most detail:

**1. `result.yaml`: the step verdict.** The failing `test.step` becomes a step with
`status: failed`. The format's verdict vocabulary separates `failed` (the check ran
and the product was wrong) from `broken` (the check could not decide). A failed
`expect` is the first kind, so the step also says what was checked:

```yaml
  - id: total-is-10-off-the-49-99-subtotal
    ordinal: 3
    title: total is 10% off the $49.99 subtotal
    status: failed
    duration_ms: 2008
    kind: assertion
    defect: Product
    expected: $44.99
    actual: $47.49
    check:
      kind: value
      matcher: toHaveText
```

**2. `steps/3-…/failure.yaml`: the forensic record.** This is the full matcher message,
the locator, where in the spec it failed, and the page state at failure. Every file
reference (`repro.definition`, `page_state.screenshot`, `page_state.a11y`) is relative
to the test directory, and the validator checks that each one exists inside the pack:

```yaml
step: total-is-10-off-the-49-99-subtotal
status: failed
title: "total is 10% off the $49.99 subtotal: expected $44.99, got $47.49"
expected: $44.99
actual: $47.49
error:
  type: AssertionError
  message: |-
    Error: expect(locator).toHaveText(expected) failed
    ...
repro:
  definition: promo-code.spec.ts
locator_context:
  locator: getByTestId('cart-total')
  source: promo-code.spec.ts:13:50
  snippet: ...
page_state:
  screenshot: steps/3-total-is-10-off-the-49-99-subtotal/screenshot.png
  a11y: steps/3-total-is-10-off-the-49-99-subtotal/error-context.md
```

**3. Root `failure.yaml`: the run-level index.** `evidence finalize` writes this
index, not the producer. It lists every step-level failure record, so a dashboard
or a triage agent can find the failure without walking `tests/`:

```yaml
totals: { failures: 1, triaged: 0, untriaged: 1 }
failures:
  - test: promo-code-save10-takes-10-off-the-cart-total
    ordinal: 3
    step: total-is-10-off-the-49-99-subtotal
    status: failed
    path: tests/promo-code-save10-takes-10-off-the-cart-total/steps/3-total-is-10-off-the-49-99-subtotal/failure.yaml
    title: "total is 10% off the $49.99 subtotal: expected $44.99, got $47.49"
```

The run's `totals` in `run.yaml` (`failed: 1`) are also derived by finalize from
the per-test verdicts.

### Mapping Playwright to the pack

`project/to-evidence.mjs` is a small converter from Playwright's JSON reporter
output to a live pack. It is a sketch of a producer, not a published reporter.

| Playwright | Pack |
| --- | --- |
| The run (`stats.startTime`, `config.version`) | `run.yaml`: `started`, `environment.producer: { name: playwright, version }` |
| A spec (`file` + `title`) | `tests/<slug>/`, with the spec file copied in as the opaque definition |
| `test.step(...)` blocks of the last attempt | `result.yaml` `steps[]`, one per step, in order |
| Each attempt | `result.yaml` `attempts[]` |
| An `expect` matcher failure | step `status: failed`, `kind: assertion`, `defect: Product`, plus `expected`/`actual` taken from the matcher's `Expected:`/`Received:` lines |
| Any other error (an action timeout, a crash) | step `status: broken`, `defect: Test` |
| The `screenshot` attachment | `steps/<ordinal>-<id>/screenshot.png` on the failed step, or on the last step of a passing test |
| The `error-context` attachment | `steps/<ordinal>-<id>/error-context.md`, referenced as `page_state.a11y` |
| The test's JSON result and stack | `logs/playwright-result.json`, `logs/error.log` |

ANSI colour codes and absolute paths from the machine that ran the tests are
stripped, so they never enter the pack.

## Reproduce it

```bash
cd examples/playwright/project
npm install
npx playwright install chromium
npx playwright test            # 1 passed, 1 failed; writes results.json and test-results/
npm run evidence               # to-evidence.mjs → playwright.evidence/, then evidence finalize seals it
npx evidence validate playwright.evidence --profile L1
```

`npx playwright test` exits non-zero because a test fails. That is expected, so run
`npm run evidence` after it either way. In CI, run the conversion in an
`if: always()` step.

`finalize` seals the directory into a range-addressable zip, in place. The
committed `playwright.evidence/` is that zip unpacked, so you can browse it here.
Run IDs, timestamps and durations change between runs. The definition hashes
don't change unless you edit the specs.

## View it

`sealed/playwright.evidence` is the sealed zip that `finalize` wrote; the
committed `playwright.evidence/` directory is exactly that zip unpacked. Open it
in the viewer the same way as the [kane-cli pack](../kane-cli/overview.md#the-viewer):

- **By URL:** GitHub's raw host answers HTTP Range requests and allows
  cross-origin reads, so the committed file works as a `?pack=` URL:
  [evidence.lambdatest.com/?pack=…/main/examples/playwright/sealed/playwright.evidence](https://evidence.lambdatest.com/?pack=https%3A%2F%2Fraw.githubusercontent.com%2FLambdaTest%2Fevidence-cli%2Fmain%2Fexamples%2Fplaywright%2Fsealed%2Fplaywright.evidence).
  For another branch, replace `main` in the encoded URL.
- **By file:** download `sealed/playwright.evidence` and drop it onto
  `https://evidence.lambdatest.com`.

If you regenerate the pack, replace `sealed/playwright.evidence` with the new
sealed zip and the directory with its unpacked contents, so the two stay in step.
