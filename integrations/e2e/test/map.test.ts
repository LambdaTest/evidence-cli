/** How a finished run maps onto the evidence pack layout: verdicts, ids, steps, failures, agent steps, and what never goes in. */

import { describe, expect, it } from 'vitest';
import { planPack } from '../src/map.js';
import { artifact, attempt, report, result, step, type ArtifactRecord, type ReportResult } from './fixtures.js';

const assertionError = { category: 'test', code: 'ASSERTION_FAILED', message: 'expect.toHaveText failed', retryable: false, details: { expected: 'text "Welcome"', observed: 'text "Invalid"', locator: 'getByRole("alert")' } } as const;

describe('planPack: the run', () => {
  it('names the producer, the window, and the run facts as typed metrics', () => {
    const plan = planPack(report([result([attempt([step()])])]));
    expect(plan.run).toMatchObject({
      evidence: '0.1',
      run_id: 'run-1',
      status: 'running',
      started: '2026-10-02T00:00:00.000Z',
      title: 'shop',
      environment: { producer: { name: 'e2e', version: '9.9.9' }, surfaces: ['web'] },
    });
    expect(plan.run['metrics']).toMatchObject({ model_tokens: { value: 1234, type: 'count' }, estimated_cost_usd: { value: 0.05, type: 'currency', unit: 'USD' } });
    expect(plan.coverage).toMatchObject({ summary: { discovered: 1 } });
  });

  it('records CI as the object the format asks for, and only when the run was in CI', () => {
    expect(planPack(report([])).run['environment']).not.toHaveProperty('ci');
    const inCi = report([]);
    (inCi.run.environment as { ci: boolean }).ci = true;
    expect(planPack(inCi).run['environment']).toMatchObject({ ci: { detected: true } });
  });

  it('writes no attempts for a result that never ran one', () => {
    const plan = planPack(report([result([], { status: 'skipped' })]));
    expect(plan.tests[0]!.result).not.toHaveProperty('attempts');
  });

  it('leaves out results the selection did not choose', () => {
    const plan = planPack(report([result([attempt([step()])]), result([], { selected: false, status: 'skipped' })]));
    expect(plan.tests).toHaveLength(1);
  });
});

describe('planPack: verdicts', () => {
  const verdict = (status: ReportResult['status'], error?: object) =>
    planPack(report([result([attempt([step()], error === undefined ? {} : { status: 'failed', error: error as never })], { status })])).tests[0]!.result['status'];

  it('says failed only when the product was wrong, broken when the check could not decide', () => {
    expect(verdict('passed')).toBe('passed');
    expect(verdict('flaky')).toBe('passed');
    expect(verdict('skipped')).toBe('skipped');
    expect(verdict('failed', assertionError)).toBe('failed');
    expect(verdict('failed', { ...assertionError, code: 'ASSERTION_INCONCLUSIVE' })).toBe('broken');
    expect(verdict('failed', { ...assertionError, code: 'LOCATOR_NOT_FOUND' })).toBe('broken');
    expect(verdict('timed-out', { ...assertionError, code: 'STEP_TIMEOUT' })).toBe('broken');
    expect(verdict('interrupted')).toBe('broken');
  });

  it('marks a flaky result, and keeps every attempt', () => {
    const plan = planPack(report([result([attempt([step()], { status: 'failed', error: assertionError as never }), attempt([step()], { index: 1 })], { status: 'flaky' })]));
    expect(plan.tests[0]!.result).toMatchObject({ flaky: true, attempts: [{ status: 'failed' }, { status: 'passed' }] });
  });

  it('maps step statuses the same way', () => {
    const steps = [
      step({ index: 0 }),
      step({ index: 1, status: 'failed', error: assertionError as never }),
      step({ index: 2, status: 'failed', error: { ...assertionError, code: 'LOCATOR_NOT_FOUND' } as never }),
      step({ index: 3, status: 'blocked' }),
      step({ index: 4, status: 'timed-out' }),
      step({ index: 5, status: 'cancelled' }),
    ];
    const planned = planPack(report([result([attempt(steps)])])).tests[0]!.result['steps'] as { status: string }[];
    expect(planned.map((entry) => entry.status)).toEqual(['passed', 'failed', 'broken', 'broken', 'broken', 'broken']);
  });
});

describe('planPack: identity and steps', () => {
  it('gives each result a path-safe folder, distinct across targets and repeats of one test', () => {
    const title = ['checkout/ü flow', 'pays %20 now'];
    const plan = planPack(report([
      result([attempt([step()])], { titlePath: title, targetId: 'web' }),
      result([attempt([step()])], { titlePath: title, targetId: 'phone' }),
      result([attempt([step()])], { titlePath: title, repeat: 1 }),
    ]));
    const dirs = plan.tests.map((test) => test.dir);
    expect(new Set(dirs).size).toBe(3);
    // Generated from the result id alone: a title never becomes a path component.
    for (const dir of dirs) expect(dir).toMatch(/^t-[0-9a-f]{16}$/);
    expect(plan.tests[0]!.result['test']).toBe(dirs[0]);
    expect(plan.tests[0]!.result['external_id']).toMatchObject({ e2e_test_id: 'tests/a.e2e.ts::saves', target: 'web', agent: 'default', repeat: 0 });
  });

  it('names each test by its title path, the name the viewer lists and heads it with', () => {
    const plan = planPack(report([
      result([attempt([step()])], { titlePath: ['sign in', 'wrong credentials surface an alert'] }),
      result([attempt([step()])], { titlePath: ['checkout'], targetId: 'phone' }),
      result([attempt([step()])], { titlePath: ['checkout'], targetId: 'web' }),
      result([attempt([step()])], { titlePath: ['checkout'], targetId: 'web', repeat: 1 }),
      result([attempt([step()])], { titlePath: ['checkout'], targetId: 'web', agent: 'thorough' }),
    ]));
    expect(plan.tests.map((test) => (test.result['external_id'] as { session_name: string }).session_name)).toEqual([
      'sign in › wrong credentials surface an alert',
      'checkout · phone',
      'checkout · web',
      'checkout · web · repeat 2',
      'checkout · web · agent thorough',
    ]);
  });

  it('numbers steps from one, ids them by attempt and index, and kinds them by api', () => {
    const plan = planPack(report([result([attempt([step({ index: 0, api: 'app.open', label: '/' }), step({ index: 1 })], { index: 2 })])]));
    expect(plan.tests[0]!.result['steps']).toEqual([
      expect.objectContaining({ id: '2-0', ordinal: 1, kind: 'app.open', label: '/', duration_ms: 12 }),
      expect.objectContaining({ id: '2-1', ordinal: 2, kind: 'locator.tap' }),
    ]);
    expect(plan.tests[0]!.steps.map((entry) => entry.folder)).toEqual(['1-2-0', '2-2-1']);
    // The definition is the test's identity from the report, never its source file: source can hold a secret as plain text.
    expect(plan.tests[0]!.definition.name).toBe('test.json');
    expect(JSON.parse(plan.tests[0]!.definition.content)).toEqual({
      e2e_test_id: 'tests/a.e2e.ts::saves',
      title: ['saves'],
      file: 'tests/a.e2e.ts',
      line: 1,
      tags: [],
    });
    expect(plan.tests[0]!.result['definition']).toEqual({ path: 'test.json' });
  });

  it('copies a step screenshot only when it is masked, and never a video, download, or incomplete trace', () => {
    const artifacts = [
      artifact('s', 'screenshot', 'complete', 'web/t/screenshots/001-step-0.png'),
      artifact('v', 'video', 'incomplete', 'web/t/video/video.webm'),
      artifact('d', 'download', 'incomplete', 'web/t/downloads/001-a.csv'),
      artifact('t', 'trace', 'incomplete', 'web/t/trace/trace.zip'),
    ];
    const plan = planPack(report([result([attempt([step({ artifacts: ['s', 'v', 'd'] })], { artifacts })])]));
    const test = plan.tests[0]!;
    expect(test.steps[0]!.screenshot).toBe('web/t/screenshots/001-step-0.png');
    const sources = [...test.steps.flatMap((entry) => [entry.screenshot, entry.screen]), ...test.logs.map((log) => log.source)];
    for (const unsafe of ['video.webm', '001-a.csv', 'trace.zip']) expect(sources.some((source) => source?.endsWith(unsafe))).toBe(false);
  });

  it('ships a trace whose redaction allows it as a log', () => {
    const plan = planPack(report([result([attempt([step()], { artifacts: [artifact('t', 'trace', 'not-required', 'web/t/trace/trace.zip')] })])]));
    // The format comes from the artifact, not from any one engine's trace.
    expect(plan.tests[0]!.logs).toContainEqual({ name: 'trace', file: 'trace.zip', format: 'trace', source: 'web/t/trace/trace.zip' });
  });
});

describe('planPack: failures', () => {
  it('writes a failure record with expected, actual, locator, url, and the failure frame and screen', () => {
    const artifacts = [artifact('f', 'screenshot', 'complete', 'web/t/screenshots/002-failure.png'), artifact('s', 'log', 'complete', 'web/t/failure/screen.txt')];
    const failing = step({ index: 1, status: 'failed', error: assertionError as never });
    const plan = planPack(report([result([attempt([step(), failing], { status: 'failed', error: assertionError as never, artifacts, failure: { url: 'http://127.0.0.1/login', screenshot: 'f', screen: 's' } })], { status: 'failed' })]));
    const entry = plan.tests[0]!.steps[1]!;
    expect(entry.screenshot).toBe('web/t/screenshots/002-failure.png');
    expect(entry.screen).toBe('web/t/failure/screen.txt');
    expect(entry.failure).toEqual({
      step: '0-1',
      status: 'failed',
      title: 'button "Save"',
      error: { message: 'expect.toHaveText failed', code: 'ASSERTION_FAILED' },
      expected: 'text "Welcome"',
      actual: 'text "Invalid"',
      locator_context: { locator: 'getByRole("alert")' },
      page_state: { url: 'http://127.0.0.1/login', screenshot: 'steps/2-0-1/screenshot.png', a11y: 'steps/2-0-1/screen.txt' },
    });
    expect(plan.tests[0]!.steps[0]!.failure).toBeUndefined();
  });
});

describe('planPack: agent steps', () => {
  it('maps a failed agent.assert to its instruction against the judgment', () => {
    const judged = step({ api: 'agent.assert', kind: 'agent', label: 'the cart shows 2 items', status: 'failed', explanation: 'The cart badge reads 1.', error: { ...assertionError, details: undefined } as never });
    const plan = planPack(report([result([attempt([judged], { status: 'failed', error: assertionError as never })], { status: 'failed' })]));
    expect(plan.tests[0]!.result['steps']).toEqual([expect.objectContaining({ kind: 'agent.assert', status: 'failed', expected: 'the cart shows 2 items', actual: 'The cart badge reads 1.' })]);
    expect(plan.tests[0]!.steps[0]!.failure).toMatchObject({ expected: 'the cart shows 2 items', actual: 'The cart badge reads 1.' });
  });

  it('keeps an act step\'s turns in a log and out of step.json, with its cache mode on the step', () => {
    const act = step({ api: 'agent.act', kind: 'agent', label: 'add shoes', turns: [{ index: 1, calls: ['tap({"target":"n1"})'], outcome: 'Tapped' }], cache: { mode: 'replayed' } as never });
    const plan = planPack(report([result([attempt([act])])]));
    const test = plan.tests[0]!;
    expect(test.steps[0]!.record).not.toHaveProperty('turns');
    expect(test.result['steps']).toEqual([expect.objectContaining({ cache: 'replayed' })]);
    const agentLog = test.logs.find((log) => log.name === 'agent');
    expect(agentLog?.content).toContain('tap({\\"target\\":\\"n1\\"})');
  });
});

describe('planPack: serial groups', () => {
  it('reads a member\'s steps and failure from its group attempt', () => {
    const member = result([], { serialGroupId: 'g1', testId: 'tests/a.e2e.ts::member', status: 'failed' });
    const doc = report([member], {
      serialGroups: [{
        id: 'g1', serialId: 's', declarationIndex: 0, file: 'tests/a.e2e.ts', source: { file: 'tests/a.e2e.ts', line: 1, column: 1 }, titlePath: ['g'],
        targetId: 'web', platform: 'web', agent: 'default', repeat: 0, memberTestIds: ['tests/a.e2e.ts::member'], status: 'failed',
        attempts: [{ id: 'ga', index: 0, status: 'failed', startedAt: '2026-10-02T00:00:00.000Z', durationMs: 5, artifacts: [], secondaryErrors: [], cleanup: 'complete',
          members: [{ id: 'm', index: 0, testId: 'tests/a.e2e.ts::member', status: 'failed', startedAt: '2026-10-02T00:00:00.000Z', durationMs: 5, steps: [step({ status: 'failed', error: assertionError as never })], error: assertionError as never, secondaryErrors: [] }] }],
      }],
    } as never);
    const test = planPack(doc).tests[0]!;
    expect(test.result['status']).toBe('failed');
    expect(test.result['steps']).toEqual([expect.objectContaining({ id: '0-0', status: 'failed' })]);
    expect(test.steps[0]!.failure).toBeDefined();
    // A member has no attempts of its own; its group's attempts are its attempts, and the format requires at least one.
    expect(test.result['attempts']).toEqual([{ status: 'failed', duration_ms: 5 }]);
    expect(test.result['duration_ms']).toBe(5);
  });
});

describe('planPack: what the viewer shows for a step', () => {
  it('writes the fields the viewer reads, with a sentence a person reads, and keeps the e2e record beside them', () => {
    const steps = [
      step({ index: 0, kind: 'app', api: 'app.open', label: '/login' }),
      step({ index: 1, api: 'locator.fill', label: 'getByLabel("Username")' }),
      step({ index: 2, api: 'locator.fill', label: 'getByLabel("Password")' }),
      step({ index: 3, api: 'locator.tap', label: 'getByRole("button", name: "Sign in")' }),
      step({ index: 4, api: 'locator.press', label: 'getByLabel("Search")' }),
      step({ index: 5, kind: 'assertion', api: 'expect.toHaveText', label: 'getByRole("alert")' }),
      step({ index: 6, kind: 'assertion', api: 'expect.not.toBeVisible', label: 'getByRole("dialog")' }),
      step({ index: 7, kind: 'agent', api: 'agent.act', label: 'add shoes to the cart', events: [{ kind: 'engine', startedAt: '2026-10-02T00:00:00.000Z', durationMs: 5, status: 'passed', detail: 'tap button "Add to cart"' }] }),
      step({ index: 8, kind: 'agent', api: 'agent.assert', label: 'the cart shows 1 item' }),
    ];
    const doc = report([result([attempt(steps)])]);
    (doc.run.targets[0] as { baseOrigin?: string }).baseOrigin = 'http://127.0.0.1:4271';
    const planned = planPack(doc).tests[0]!.steps.map((entry) => entry.record);
    expect(planned.map((record) => record['summary'])).toEqual([
      'Open /login',
      'Fill getByLabel("Username")',
      'Fill getByLabel("Password")',
      'Tap getByRole("button", name: "Sign in")',
      'Press getByLabel("Search")',
      'Expect getByRole("alert") to have text',
      'Expect getByRole("dialog") not to be visible',
      'Act: add shoes to the cart (tap button "Add to cart")',
      'Assert: the cart shows 1 item',
    ]);
    expect(planned[1]).toMatchObject({ id: '0-1', kind: 'locator.fill', status: 'passed', duration_ms: 12, e2e: { label: 'getByLabel("Username")' } });
    expect(planned[0]).toMatchObject({ url: 'http://127.0.0.1:4271/login' });
    expect(planned[1]).not.toHaveProperty('url');
    expect(planned[7]!['e2e']).not.toHaveProperty('turns');
  });

  it('reads any other api as its verb in words', () => {
    const steps = [
      step({ index: 0, kind: 'screen', api: 'screen.scrollUntilVisible', label: 'getByTestId("item-137")' }),
      step({ index: 1, kind: 'app', api: 'device.back', label: '' }),
      step({ index: 2, kind: 'app', api: 'device.openLink', label: 'myapp://settings' }),
    ];
    const planned = planPack(report([result([attempt(steps)])])).tests[0]!.steps.map((entry) => entry.record['summary']);
    expect(planned).toEqual(['Scroll until visible getByTestId("item-137")', 'Back', 'Open link myapp://settings']);
  });

  it('keeps an acronym whole in a matcher name', () => {
    const steps = [step({ index: 0, kind: 'assertion', api: 'expect.toHaveURL', label: '/dashboard' }), step({ index: 1, kind: 'assertion', api: 'expect.toHaveTitle', label: 'Playground' })];
    const planned = planPack(report([result([attempt(steps)])])).tests[0]!.steps.map((entry) => entry.record['summary']);
    expect(planned).toEqual(['Expect /dashboard to have URL', 'Expect Playground to have title']);
  });

  it('puts the failure URL on the failing step', () => {
    const failing = step({ index: 1, status: 'failed', error: assertionError as never });
    const plan = planPack(report([result([attempt([step(), failing], { status: 'failed', error: assertionError as never, failure: { url: 'http://127.0.0.1/login' } })], { status: 'failed' })]));
    expect(plan.tests[0]!.steps[1]!.record).toMatchObject({ url: 'http://127.0.0.1/login', status: 'failed' });
  });
});

describe('planPack: the screen size', () => {
  it('names the viewport size the frames were taken at, when a step recorded one', () => {
    const steps = [step({ index: 0 }), step({ index: 1, viewport: { width: 1280, height: 720, scale: 2 } })];
    const plan = planPack(report([result([attempt(steps)])]));
    expect(plan.tests[0]!.result['environment']).toMatchObject({ resolution: '1280x720' });
    expect(planPack(report([result([attempt([step()])])])).tests[0]!.result).not.toHaveProperty('environment');
  });
});
