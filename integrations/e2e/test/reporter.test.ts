/** The reporter around the pack: where it writes, when it writes nothing, and how it reports what it did. */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { FinishedRun } from 'e2e';
import { afterEach, describe, expect, it } from 'vitest';
import { evidence, type EvidenceOptions } from '../src/index.js';
import { attempt, report, result, step } from './fixtures.js';

const dirs: string[] = [];
const savedFlag = process.env['E2E_EVIDENCE'];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  if (savedFlag === undefined) delete process.env['E2E_EVIDENCE'];
  else process.env['E2E_EVIDENCE'] = savedFlag;
});

/** A finished run in a fresh project: `.e2e/report.json` written, one passing test with a frame on its step. */
function finishedRun(overrides: Partial<FinishedRun> = {}): FinishedRun & { readonly root: string } {
  const root = mkdtempSync(path.join(os.tmpdir(), 'e2e-evidence-'));
  dirs.push(root);
  const artifactsRoot = path.join(root, '.e2e', 'artifacts');
  mkdirSync(path.join(artifactsRoot, 'web', 'shots'), { recursive: true });
  writeFileSync(path.join(artifactsRoot, 'web', 'shots', 'one.png'), 'png');
  const shot = { id: 'a1', kind: 'screenshot', path: 'web/shots/one.png', redaction: 'not-required', status: 'complete' };
  const doc = report([result([attempt([step({ artifacts: ['a1'] })], { artifacts: [shot] as never })])]);
  const reportPath = path.join(root, '.e2e', 'report.json');
  writeFileSync(reportPath, JSON.stringify(doc));
  return { root, report: doc, status: 'passed', exitCode: 0, projectRoot: root, reportPath, artifactsRoot, aiTracePath: undefined, ...overrides } as FinishedRun & { root: string };
}

/** Runs the reporter's `onRunFinished` for `run`. */
async function finish(options: EvidenceOptions, run: FinishedRun) {
  return evidence(options).onRunFinished!(run, new AbortController().signal);
}

describe('evidence()', () => {
  it('writes one sealed pack in .e2e/evidence and names it in the summary', async () => {
    const run = finishedRun();
    const summary = await finish({}, run);
    const outDir = path.join(run.root, '.e2e', 'evidence');
    const packs = readdirSync(outDir);
    expect(packs).toEqual([`${run.report.run.id}.evidence`]);
    // Sealed: a zip at the pack's path, not a directory.
    expect(readFileSync(path.join(outDir, packs[0]!)).subarray(0, 2).toString('latin1')).toBe('PK');
    expect(summary).toEqual([{ label: 'Evidence', text: path.join('.e2e', 'evidence', packs[0]!) }]);
  });

  it('writes into outDir, relative to the project root, and keeps only the latest pack there', async () => {
    const run = finishedRun();
    const outDir = path.join(run.root, 'packs');
    mkdirSync(outDir);
    writeFileSync(path.join(outDir, 'older.evidence'), 'old pack');
    writeFileSync(path.join(outDir, 'notes.txt'), 'kept');
    await finish({ outDir: 'packs' }, run);
    expect(readdirSync(outDir).toSorted()).toEqual(['notes.txt', `${run.report.run.id}.evidence`]);
  });

  it('writes nothing with enabled: false, or with E2E_EVIDENCE=0 whatever the options say', async () => {
    const run = finishedRun();
    expect(await finish({ enabled: false }, run)).toBeUndefined();
    for (const flag of ['0', 'false', 'OFF']) {
      process.env['E2E_EVIDENCE'] = flag;
      expect(await finish({ enabled: true }, run)).toBeUndefined();
    }
    expect(existsSync(path.join(run.root, '.e2e', 'evidence'))).toBe(false);
  });

  it('leaves the previous pack where it is when the run wrote no report', async () => {
    const run = finishedRun({ reportPath: undefined });
    const outDir = path.join(run.root, '.e2e', 'evidence');
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, 'previous.evidence'), 'pack');
    expect(await finish({}, run)).toEqual([{ label: 'Evidence', text: 'not written: the run wrote no report' }]);
    expect(readdirSync(outDir)).toEqual(['previous.evidence']);
  });

  it('refuses an outDir inside the artifacts directory, which each run clears', async () => {
    const run = finishedRun();
    const summary = await finish({ outDir: '.e2e/artifacts/packs' }, run);
    expect(summary).toEqual([{ label: 'Evidence', text: expect.stringContaining('inside the artifacts directory') }]);
    expect(existsSync(path.join(run.artifactsRoot, 'packs'))).toBe(false);
  });

  it('reports a pack it could not write as a summary line, and never fails the run', async () => {
    const run = finishedRun();
    // A file where the output directory must go makes the write fail.
    writeFileSync(path.join(run.root, 'blocker'), '');
    const summary = await finish({ outDir: 'blocker/packs' }, run);
    expect(summary).toEqual([{ label: 'Evidence', text: expect.stringMatching(/^not written: /) }]);
    expect(existsSync(path.join(run.root, 'blocker', 'packs'))).toBe(false);
  });

  it('throws on an option a typo would otherwise ignore', () => {
    expect(() => evidence({ outdir: 'x' } as never)).toThrow(/no option "outdir"/);
    expect(() => evidence({ profile: 'L2' } as never)).toThrow(/'L0' or 'L1'/);
    expect(() => evidence({ enabled: 'no' } as never)).toThrow(/boolean/);
    expect(() => evidence({ outDir: ' ' })).toThrow(/non-empty/);
  });
});
