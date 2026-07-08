/**
 * Bounded retry for filesystem operations that fail with a TRANSIENT lock.
 *
 * On Windows, renaming a directory (or removing it) fails with
 * ERROR_ACCESS_DENIED — surfaced by Node as EPERM/EACCES — while any other
 * process holds an open handle to anything inside its tree. Antivirus
 * real-time scans and search indexers open freshly-written files for
 * milliseconds-to-seconds, which is exactly when the atomic seal renames run.
 * POSIX renames never block on open handles, so these codes there mean a real
 * permission problem — the retry just delays the same failure by a few
 * seconds, which is an acceptable cost for one shared code path.
 */
const TRANSIENT_CODES = new Set(["EPERM", "EACCES", "EBUSY"]);

export interface RetryOptions {
  /** Total tries including the first (default 10). */
  attempts?: number;
  /** Base backoff: try n waits min(n * delayMs, 1000) ms (default 100). */
  delayMs?: number;
  /** Injectable for tests; defaults to setTimeout. */
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function retryTransient<T>(op: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 10;
  const delayMs = opts.delayMs ?? 100;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 1; ; attempt++) {
    try {
      return await op();
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (!code || !TRANSIENT_CODES.has(code) || attempt >= attempts) throw e;
      await sleep(Math.min(attempt * delayMs, 1000));
    }
  }
}
