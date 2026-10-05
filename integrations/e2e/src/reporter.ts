/**
 * The evidence reporter: once the run has finished, one sealed
 * `<runId>.evidence` pack, built from the report and the artifacts it links.
 * Like every reporter it never decides the run: a pack that cannot be written
 * or does not validate is a summary line, and a half-written directory is
 * removed.
 */

import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Reporter, ReporterSummary } from 'e2e';
import { planPack } from './map.js';
import { sealPack } from './seal.js';
import { writePack } from './write.js';

export interface EvidenceOptions {
  /** Directory the pack is written in, relative to the project root. Default: `evidence` beside the run's `artifacts` directory (`.e2e/evidence`). */
  readonly outDir?: string;
  /** The conformance profile the sealed pack is validated at. Default `L1`. */
  readonly profile?: 'L0' | 'L1';
  /** `false` writes no pack. `E2E_EVIDENCE=0` (or `false`, `off`) turns it off too, without editing the config. */
  readonly enabled?: boolean;
}

const OPTION_KEYS: ReadonlySet<string> = new Set(['outDir', 'profile', 'enabled']);

/**
 * The reporter that writes each run as a sealed, validated `.evidence` pack.
 * Add it to `reporters` in the e2e config: `reporters: ['list', evidence()]`.
 */
export function evidence(options: EvidenceOptions = {}): Reporter {
  checkOptions(options);
  const profile = options.profile ?? 'L1';
  return {
    name: 'evidence',
    async onRunFinished(run, signal): Promise<ReporterSummary | void> {
      if (!enabled(options, process.env)) return;
      // No report was written (the run stopped before its tests, or the write failed): the pack follows the report, and the previous one stays.
      if (run.reportPath === undefined) return [{ label: 'Evidence', text: 'not written: the run wrote no report' }];
      const outDir = options.outDir === undefined ? path.join(path.dirname(run.artifactsRoot), 'evidence') : path.resolve(run.projectRoot, options.outDir);
      if (inside(run.artifactsRoot, outDir)) return [{ label: 'Evidence', text: 'not written: outDir is inside the artifacts directory, which each run clears' }];
      const report = run.report;
      const packDir = path.join(outDir, `${pathSegment(report.run.id)}.evidence`);
      const shown = (file: string): string => path.relative(run.projectRoot, file) || file;
      try {
        // The directory holds the latest run's pack only, as artifacts/ holds the latest run's files.
        await removePacks(outDir);
        await writePack(planPack(report), packDir, { artifactsRoot: run.artifactsRoot }, signal);
        signal.throwIfAborted();
        // The seal cannot be interrupted midway; a cancelled reporter stops waiting, and the catch removes the pack.
        const sealed = await raceAbort(sealPack(packDir, report.run.finishedAt, profile), signal);
        const errors = sealed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
        return [
          { label: 'Evidence', text: shown(sealed.sealedPath) },
          ...(sealed.valid
            ? []
            : [{ label: 'Evidence', text: `invalid at ${profile}: ${errors.length} error${errors.length === 1 ? '' : 's'}, first ${errors[0]?.code ?? 'unknown'} at ${errors[0]?.location ?? '?'}` }]),
        ];
      } catch (cause) {
        await rm(packDir, { recursive: true, force: true }).catch(() => undefined);
        const reason = cause instanceof Error ? cause.message : String(cause);
        return [{ label: 'Evidence', text: `not written: ${printable(reason)}` }];
      }
    },
  };
}

/** Throws on options a config typo would otherwise silently ignore. */
function checkOptions(options: EvidenceOptions): void {
  if (typeof options !== 'object' || options === null) throw new TypeError('evidence() takes an options object');
  for (const key of Object.keys(options)) {
    if (!OPTION_KEYS.has(key)) throw new TypeError(`evidence() has no option "${key}"; the options are outDir, profile, and enabled`);
  }
  if (options.enabled !== undefined && typeof options.enabled !== 'boolean') throw new TypeError('evidence({ enabled }) must be a boolean');
  if (options.profile !== undefined && options.profile !== 'L0' && options.profile !== 'L1') throw new TypeError("evidence({ profile }) must be 'L0' or 'L1'");
  if (options.outDir !== undefined && (typeof options.outDir !== 'string' || options.outDir.trim() === '')) {
    throw new TypeError('evidence({ outDir }) must be a non-empty path');
  }
}

/** `E2E_EVIDENCE=0|false|off` wins over the options, so CI can turn packs off without a config change. */
function enabled(options: EvidenceOptions, env: NodeJS.ProcessEnv): boolean {
  const flag = env['E2E_EVIDENCE']?.trim().toLowerCase();
  if (flag === '0' || flag === 'false' || flag === 'off') return false;
  return options.enabled ?? true;
}

/** Whether `candidate` is `root` or under it. */
function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** A run id as one safe path component: never a separator, never `.` or `..`. */
function pathSegment(value: string): string {
  const segment = value.replace(/[^A-Za-z0-9._-]/g, '_');
  return segment === '' || /^\.+$/.test(segment) ? 'run' : segment;
}

/** One line of text with terminal control characters removed. */
function printable(text: string): string {
  return text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').trim();
}

/** `promise`, or a rejection as soon as `signal` aborts. */
function raceAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new Error('the run stopped waiting for the pack'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('the run stopped waiting for the pack'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (cause: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(cause instanceof Error ? cause : new Error(String(cause)));
      },
    );
  });
}

/** Removes earlier packs, sealed or left half-written, and nothing else: `outDir` may be shared. */
async function removePacks(outDir: string): Promise<void> {
  const entries = await readdir(outDir).catch(() => [] as string[]);
  await Promise.all(
    entries.filter((name) => /\.evidence(\.(tmp|bak)-[^/]*)?$/.test(name)).map((name) => rm(path.join(outDir, name), { recursive: true, force: true })),
  );
}
