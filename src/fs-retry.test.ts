import { describe, expect, it } from "vitest";
import { retryTransient } from "./fs-retry";

/** Build an errno-style error the way node:fs raises them. */
function errnoError(code: string): Error {
  const e = new Error(`${code}: operation not permitted`) as Error & { code: string };
  e.code = code;
  return e;
}

describe("retryTransient", () => {
  it("returns the result on first success without sleeping", async () => {
    let sleeps = 0;
    const result = await retryTransient(async () => "ok", {
      sleep: async () => { sleeps++; },
    });
    expect(result).toBe("ok");
    expect(sleeps).toBe(0);
  });

  it.each(["EPERM", "EACCES", "EBUSY"])("retries on %s until the operation succeeds", async (code) => {
    let attempts = 0;
    const result = await retryTransient(
      async () => {
        attempts++;
        if (attempts < 3) throw errnoError(code);
        return "sealed";
      },
      { sleep: async () => {} },
    );
    expect(result).toBe("sealed");
    expect(attempts).toBe(3);
  });

  it("rethrows a non-transient error immediately (single attempt)", async () => {
    let attempts = 0;
    await expect(
      retryTransient(
        async () => {
          attempts++;
          throw errnoError("ENOENT");
        },
        { sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(attempts).toBe(1);
  });

  it("gives up after `attempts` tries and rethrows the last error", async () => {
    let attempts = 0;
    await expect(
      retryTransient(
        async () => {
          attempts++;
          throw errnoError("EPERM");
        },
        { attempts: 4, sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ code: "EPERM" });
    expect(attempts).toBe(4);
  });

  it("backs off linearly, capped at 1s", async () => {
    const delays: number[] = [];
    let attempts = 0;
    await retryTransient(
      async () => {
        attempts++;
        if (attempts < 14) throw errnoError("EBUSY");
        return "ok";
      },
      { attempts: 20, delayMs: 100, sleep: async (ms) => { delays.push(ms); } },
    );
    expect(delays.slice(0, 3)).toEqual([100, 200, 300]);
    expect(Math.max(...delays)).toBe(1000); // capped
    expect(delays).toHaveLength(13);
  });

  it("rethrows an error without a code immediately", async () => {
    let attempts = 0;
    await expect(
      retryTransient(
        async () => {
          attempts++;
          throw new Error("plain failure");
        },
        { sleep: async () => {} },
      ),
    ).rejects.toThrow("plain failure");
    expect(attempts).toBe(1);
  });
});
