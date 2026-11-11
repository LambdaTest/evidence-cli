#!/usr/bin/env node
// Turn a Playwright JSON report into a live (unsealed) .evidence pack.
//
//   npx playwright test                       # writes results.json + test-results/
//   node to-evidence.mjs results.json playwright.evidence
//   npx evidence finalize playwright.evidence # rolls up totals, hashes, failure index; seals
//
// A sketch of a producer, not a published reporter: it maps one project, the
// last attempt of each test, and its `test.step` blocks.

import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stringify } from 'yaml';

const [reportPath = 'results.json', outDir = 'playwright.evidence'] = process.argv.slice(2);
const report = JSON.parse(readFileSync(reportPath, 'utf8'));
const rootDir = report.config.rootDir; // the testDir, absolute
const projectDir = dirname(resolve(reportPath));

const stripAnsi = (s = '') => s.replace(/\u001b\[[0-9;]*m/g, '');
// Absolute paths from this machine never enter the pack.
const scrub = (s = '') => stripAnsi(s).split(projectDir + '/').join('');
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const yaml = (file, doc) => writeFileSync(file, stringify(doc, { lineWidth: 0 }));

// A failed `expect` means the check ran and the product was wrong: `failed`.
// Anything else (an action timeout, a crash) means the check never decided: `broken`.
const isAssertion = (error) => /^Error: expect\(/.test(stripAnsi(error?.message));
const verdictOf = (result) => {
  if (result.status === 'passed') return 'passed';
  if (result.status === 'skipped') return 'skipped';
  return isAssertion(result.errors?.[0]) ? 'failed' : 'broken';
};
// Pull the matcher's own Expected / Received lines out of the message.
const field = (msg, name) => stripAnsi(msg).match(new RegExp(`^${name}:\\s+(.*)$`, 'm'))?.[1]?.replace(/^"(.*)"$/, '$1');

function* specs(suite) {
  for (const spec of suite.specs ?? []) yield spec;
  for (const child of suite.suites ?? []) yield* specs(child);
}

mkdirSync(join(outDir, 'coverage'), { recursive: true });
writeFileSync(join(outDir, 'coverage', '.keep'), '');

for (const suite of report.suites) {
  for (const spec of specs(suite)) {
    const test = spec.tests[0];
    const result = test.results.at(-1);
    const id = slug(`${basename(spec.file, '.spec.ts')}-${spec.title}`);
    const dir = join(outDir, 'tests', id);
    mkdirSync(join(dir, 'logs'), { recursive: true });

    // The definition is the spec file itself: opaque to the format, hashed by finalize.
    const definition = basename(spec.file);
    copyFileSync(join(rootDir, spec.file), join(dir, definition));

    const steps = result.steps.map((s, i) => {
      const step = { id: slug(s.title), ordinal: i + 1, title: s.title, status: 'passed', duration_ms: s.duration };
      if (s.error) {
        const assertion = isAssertion(s.error);
        step.status = assertion ? 'failed' : 'broken';
        step.kind = assertion ? 'assertion' : 'action';
        step.defect = assertion ? 'Product' : 'Test';
        const expected = field(s.error.message, 'Expected');
        const actual = field(s.error.message, 'Received');
        if (expected && actual) Object.assign(step, { expected, actual });
        step.check = { kind: 'value', matcher: stripAnsi(s.error.message).match(/\)\.(\w+)\(/)?.[1] };
      }
      return step;
    });

    yaml(join(dir, 'result.yaml'), {
      evidence: '0.1',
      test: id,
      status: verdictOf(result),
      title: spec.title,
      definition: { path: definition },
      duration_ms: result.duration,
      external_id: { playwright_test_id: spec.id, file: spec.file, line: spec.line },
      environment: { project: test.projectName || 'chromium', browser: 'chromium' },
      attempts: test.results.map((r) => ({ status: verdictOf(r), duration_ms: r.duration })),
      steps,
    });

    // Every step gets a folder. step.json is the per-step record the viewer
    // reads for its label (summary) and address bar (url); screenshot.png is
    // what the page looked like when the step ended. Both come from the
    // attachments the `step()` helper in tests/fixtures.ts records.
    const attachment = (name) => result.attachments.find((a) => a.name === name);
    const save = (a, file) => {
      if (a?.path) copyFileSync(a.path, file);
      else if (a?.body) writeFileSync(file, Buffer.from(a.body, 'base64'));
      return Boolean(a?.path || a?.body);
    };
    const text = (a) => (a?.body ? Buffer.from(a.body, 'base64').toString('utf8') : a?.path ? readFileSync(a.path, 'utf8') : undefined);
    const failedAt = result.steps.findIndex((s) => s.error);
    for (const step of steps) {
      const stepDir = join(dir, 'steps', `${step.ordinal}-${step.id}`);
      mkdirSync(stepDir, { recursive: true });
      let shot = save(attachment(`step-screenshot:${step.title}`), join(stepDir, 'screenshot.png'));
      // Fall back to Playwright's own end-of-test screenshot for the step it ended on.
      const endsTest = step === steps.at(failedAt);
      if (!shot && endsTest) shot = save(attachment('screenshot'), join(stepDir, 'screenshot.png'));
      writeFileSync(join(stepDir, 'step.json'), JSON.stringify({
        id: step.id,
        kind: step.kind ?? 'action',
        status: step.status,
        summary: step.title,
        url: text(attachment(`step-url:${step.title}`)),
        duration_ms: step.duration_ms,
      }, null, 2) + '\n');
    }
    const last = steps.at(failedAt);

    const failedStep = failedAt === -1 ? null : result.steps[failedAt];
    if (failedStep) {
      const stepDir = join(dir, 'steps', `${last.ordinal}-${last.id}`);
      const snapshot = save(attachment('error-context'), join(stepDir, 'error-context.md'));
      const loc = failedStep.error.location;
      yaml(join(stepDir, 'failure.yaml'), {
        step: last.id,
        status: last.status,
        title: `${last.title}: expected ${last.expected}, got ${last.actual}`,
        expected: last.expected,
        actual: last.actual,
        error: {
          type: isAssertion(failedStep.error) ? 'AssertionError' : 'Error',
          message: scrub(failedStep.error.message).trim(),
        },
        repro: { definition },
        locator_context: {
          locator: field(failedStep.error.message, 'Locator'),
          source: loc && `${relative(rootDir, loc.file)}:${loc.line}:${loc.column}`,
          snippet: stripAnsi(failedStep.error.snippet),
        },
        page_state: {
          screenshot: `steps/${last.ordinal}-${last.id}/screenshot.png`,
          ...(snapshot && { a11y: `steps/${last.ordinal}-${last.id}/error-context.md` }),
        },
      });
    }

    // Logs: the test's slice of the JSON report, and its stack trace when it failed.
    const logs = [{ name: 'playwright-result', file: 'playwright-result.json', format: 'json' }];
    writeFileSync(join(dir, 'logs', 'playwright-result.json'),
      scrub(JSON.stringify({ ...spec, tests: [{ ...test, results: [{ ...result, attachments: result.attachments.map(({ body, ...a }) => ({ ...a, ...(a.path && { path: basename(a.path) }) })) }] }] }, null, 2)) + '\n');
    if (result.errors?.length) {
      writeFileSync(join(dir, 'logs', 'error.log'), result.errors.map((e) => scrub(e.stack ?? e.message)).join('\n\n') + '\n');
      logs.push({ name: 'error', file: 'error.log', format: 'log' });
    }
    yaml(join(dir, 'logs', 'meta.yaml'), { logs });
  }
}

yaml(join(outDir, 'run.yaml'), {
  evidence: '0.1',
  run_id: randomUUID(),
  status: 'running',
  title: 'Demo Shop — cart checks (Playwright)',
  started: report.stats.startTime,
  environment: {
    producer: { name: 'playwright', version: report.config.version },
    browser: 'chromium',
    workers: report.config.workers,
  },
});

console.log(`wrote ${outDir}: ${report.stats.expected} passed, ${report.stats.unexpected} failed — now run: evidence finalize ${outDir}`);
