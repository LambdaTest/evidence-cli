# @testmuai/e2e-evidence

An [e2e](https://github.com/tester-army/e2e) reporter that writes each run as a
sealed, validated `.evidence` pack: one file you can attach to a pull request,
upload from CI, and open at [evidence.lambdatest.com](https://evidence.lambdatest.com).

## Install

```bash
npm install -D @testmuai/e2e-evidence
```

It needs `e2e` 0.17 or later and Node 22.12 or later.

## Use

Add it to `reporters` in `e2e.config.ts`:

```ts
import type { E2EConfig } from 'e2e';
import { web } from '@e2e-dev/web';
import { evidence } from '@testmuai/e2e-evidence';

export default {
  targets: [{ engine: web(), app: { url: 'http://localhost:3000' } }],
  reporters: ['list', evidence()],
} satisfies E2EConfig;
```

After every run the terminal summary names the pack:

```
     Report  .e2e/report.json
   Evidence  .e2e/evidence/01a10bfd-8b2d-7735-b776-83a7f5adb0ae.evidence
```

The directory keeps the latest run's pack only, the way `.e2e/artifacts/`
keeps the latest run's files. Add `.e2e/evidence/` to `.gitignore`.

### Options

| Option | Default | |
| --- | --- | --- |
| `outDir` | `.e2e/evidence` | Where the pack goes, relative to the project root. Not inside `.e2e/artifacts`, which each run clears. |
| `profile` | `'L1'` | The profile the sealed pack is validated at, `'L0'` or `'L1'`. |
| `enabled` | `true` | `false` writes no pack. |

`E2E_EVIDENCE=0` (or `false`, `off`) turns it off for one run without
editing the config.

The reporter never changes a run's outcome or exit code. A pack it cannot
write, or one that does not validate, is a line in the summary.

## What goes in the pack

| e2e | Pack |
| --- | --- |
| The run | `run.yaml`: id, start and end, producer, platforms, host, CI, models, commit, and test, token, byte, and cost counts |
| Each selected result | `tests/t-<id>/`, named in the viewer by its title path, plus target, agent, or repeat when they tell results apart |
| The test's identity | `test.json`: id, title path, file, line, tags (never the test's source) |
| Each step of the last attempt | `steps/<n>-<attempt>-<step>/step.json`: a one-line summary, status, duration, and the URL an `app.open` reached, with the report's step record beside them |
| A screenshot the run took | `screenshot.png` on its step: the failure frame, and an `app.screenshot` |
| A failure | `failure.yaml` on the step it landed on: error, expected and actual, locator, URL, frame, and screen text |
| Agent steps | `Act: <instruction> (<what it did>)` summaries, cache mode on the step, turns in `logs/agent.ndjson` |
| Traces | `logs/trace.zip`, when its redaction allows sharing |

Verdicts: `ASSERTION_FAILED` is `failed` (the product was wrong). Every other
failure (a timeout, a locator that matched nothing, an inconclusive judgment)
is `broken` (the check could not decide). A flaky result passes and is marked
`flaky`, with every attempt listed.

Only artifacts whose redaction is `complete` or `not-required` are copied, so a
frame taken after a secret was typed never enters the pack. Secret values are
already redacted in the report the pack is built from.

## Not yet

The pack is built from e2e's report, so it has what the report has. Three
things the viewer can show need the report to carry more first:

- The value a step typed, pressed, or selected. Summaries read `Fill
  getByLabel("Username")` rather than `Fill getByLabel("Username") with "ada"`.
- Where a step acted, the cursor point and element box the viewer draws over
  the frame.
- A frame on every step. e2e takes a screenshot on failure; steps that passed
  have none, which the validator reports as a warning, not an error.

## Viewing a pack from CI

Upload the pack as a GitHub Actions artifact:

```yaml
- name: Upload evidence
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: evidence
    path: .e2e/evidence/*.evidence
```

and open `https://evidence.lambdatest.com/?pack=<url-encoded artifact URL>`,
where the artifact URL is
`https://github.com/<owner>/<repo>/actions/runs/<run id>/artifacts/<artifact id>`.
The viewer asks you to sign in with GitHub to read it.
