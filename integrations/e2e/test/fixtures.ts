/** Report-1 documents built by hand, the shape `onRunFinished` receives. */

import type { Report } from 'e2e';

export type Report1Document = Report;
export type ReportResult = Report['run']['results'][number];
export type ReportAttempt = ReportResult['attempts'][number];
export type ReportStep = ReportAttempt['steps'][number];
export type ArtifactRecord = ReportAttempt['artifacts'][number];

let seq = 0;

export function step(overrides: Partial<ReportStep> = {}): ReportStep {
  const index = overrides.index ?? 0;
  return {
    id: `att:${index}`,
    index,
    kind: 'locator',
    api: 'locator.tap',
    label: 'button "Save"',
    source: { file: 'tests/a.e2e.ts', line: 3, column: 3 },
    status: 'passed',
    startedAt: '2026-10-02T00:00:00.000Z',
    durationMs: 12,
    events: [],
    artifacts: [],
    ...overrides,
  };
}

export function attempt(steps: readonly ReportStep[], overrides: Partial<ReportAttempt> = {}): ReportAttempt {
  return {
    id: 'att',
    index: 0,
    status: 'passed',
    startedAt: '2026-10-02T00:00:00.000Z',
    durationMs: 100,
    artifacts: [],
    secondaryErrors: [],
    cleanup: 'complete',
    steps,
    ...overrides,
  };
}

export function result(attempts: readonly ReportAttempt[], overrides: Partial<ReportResult> = {}): ReportResult {
  seq += 1;
  return {
    id: `${seq.toString(16).padStart(8, '0')}${'ab'.repeat(28)}`,
    testId: 'tests/a.e2e.ts::saves',
    kind: 'test',
    declarationIndex: 0,
    titlePath: ['saves'],
    file: 'tests/a.e2e.ts',
    source: { file: 'tests/a.e2e.ts', line: 1, column: 1 },
    targetId: 'web',
    platform: 'web',
    agent: 'default',
    repeat: 0,
    tags: [],
    selected: true,
    status: 'passed',
    attempts,
    ...overrides,
  };
}

export function report(results: readonly ReportResult[], extra: Partial<Report1Document['run']> = {}): Report1Document {
  return {
    schemaVersion: 'report-1',
    run: {
      id: 'run-1',
      specVersion: '0.1',
      runner: { name: 'e2e', version: '9.9.9' },
      status: 'passed',
      exitCode: 0,
      startedAt: '2026-10-02T00:00:00.000Z',
      finishedAt: '2026-10-02T00:01:00.000Z',
      project: { id: 'shop', configDigest: 'd' },
      environment: { ci: false, trustNoticeShown: false, os: 'darwin', arch: 'arm64', runtime: 'node 24' },
      targets: [{ id: 'web', index: 0, platform: 'web', environment: 'local', engine: { name: 'web', version: '1.0.0', spiVersion: 1 }, capabilities: [], artifactCapabilities: [], stateCapability: false }],
      serialGroups: [],
      results,
      errors: [],
      summary: { discovered: results.length, selected: results.length, executed: results.length, passed: 0, failed: 0, flaky: 0, skipped: 0 },
      limits: {} as Report1Document['run']['limits'],
      usage: { discoveredResults: 0, maxAgentContextBytes: 0, maxLedgerBytes: 0, maxObservationBytes: 0, artifactBytes: 0, downloads: 0, events: 0, modelTokens: 1234, maxModelCallsInStep: 0, maxActionStepsInStep: 0, estimatedCostUsd: 0.05 },
      ...extra,
    },
  } as Report1Document;
}

export function artifact(id: string, kind: ArtifactRecord['kind'], redaction: ArtifactRecord['redaction'], path: string): ArtifactRecord {
  return { id, kind, mediaType: kind === 'screenshot' ? 'image/png' : 'application/octet-stream', path, redaction, producer: { kind: 'attempt' } } as ArtifactRecord;
}

