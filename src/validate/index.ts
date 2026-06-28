import { CONTRACT_VERSION, Codes, DEFAULT_PROFILE } from "../contract";
import type { Diagnostic, ValidationReport } from "../contract";
import { err } from "../diagnostics";
import { openContainer } from "../pack/container";
import { loadSchemas } from "../schemas/compile";
import { parseYaml } from "../yaml";
import { runCrossChecks } from "./checks";
import type { ValidateFunction } from "ajv";

export interface ValidateOptions {
  profile?: string;
}

export async function validate(
  target: string,
  opts: ValidateOptions = {},
): Promise<ValidationReport> {
  const profile = opts.profile ?? DEFAULT_PROFILE;
  const diagnostics: Diagnostic[] = [];
  const finish = (): ValidationReport => ({
    valid: !diagnostics.some((d) => d.severity === "error"),
    profile,
    version: CONTRACT_VERSION,
    diagnostics,
  });

  const container = await openContainer(target);

  const manifestRaw = await container.readManifest();
  if (manifestRaw == null) {
    diagnostics.push(
      err(Codes.MANIFEST_MISSING, "run.yaml", "no top-level run.yaml — not a valid evidence pack"),
    );
    return finish();
  }

  let run: any;
  try {
    run = parseYaml(manifestRaw);
  } catch (e: any) {
    diagnostics.push(err(Codes.MANIFEST_PARSE, "run.yaml", `run.yaml is not valid YAML: ${e?.message ?? e}`));
    return finish();
  }

  // Version gate (decision 0027): reject rather than mis-read; halt on mismatch.
  const vg = versionGate(run, "run.yaml");
  if (vg) {
    diagnostics.push(vg);
    return finish();
  }

  const schemas = loadSchemas(CONTRACT_VERSION, profile);
  diagnostics.push(...schemaDiagnostics(schemas.run, run, "run.yaml"));

  const testIds = await container.listTestIds();
  const tests: { testId: string; result: any }[] = [];
  for (const testId of testIds) {
    const loc = `tests/${testId}/result.yaml`;
    const raw = await container.readResult(testId);
    if (raw == null) {
      diagnostics.push(err(Codes.RESULT_MISSING, loc, `missing result.yaml for test "${testId}"`));
      continue;
    }
    let result: any;
    try {
      result = parseYaml(raw);
    } catch (e: any) {
      diagnostics.push(err(Codes.RESULT_PARSE, loc, `result.yaml is not valid YAML: ${e?.message ?? e}`));
      continue;
    }
    const rvg = versionGate(result, loc);
    if (rvg) {
      diagnostics.push(rvg);
      continue; // skip this result's further checks
    }
    diagnostics.push(...schemaDiagnostics(schemas.result, result, loc));
    tests.push({ testId, result });
  }

  diagnostics.push(...(await runCrossChecks({ run, tests, container })));

  return finish();
}

function versionGate(obj: any, location: string): Diagnostic | null {
  const v = obj?.evidence;
  if (v === undefined || v === null) return null; // schema reports the required field
  if (v !== CONTRACT_VERSION) {
    return err(
      Codes.VERSION_UNSUPPORTED,
      location,
      `pack declares evidence ${JSON.stringify(v)}; this validator implements ${CONTRACT_VERSION} — cannot validate`,
    );
  }
  return null;
}

function schemaDiagnostics(
  validateFn: ValidateFunction,
  data: unknown,
  location: string,
): Diagnostic[] {
  if (validateFn(data)) return [];
  return (validateFn.errors ?? []).map((e) =>
    err(
      Codes.SCHEMA,
      `${location}${e.instancePath || ""}`,
      `${e.instancePath || "/"} ${e.message ?? "schema violation"}`,
    ),
  );
}
