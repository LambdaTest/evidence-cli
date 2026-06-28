import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { getSchemas } from "./registry";

export interface CompiledSchemas {
  run: ValidateFunction;
  result: ValidateFunction;
}

const cache = new Map<string, CompiledSchemas>();

export function loadSchemas(version: string, profile: string): CompiledSchemas {
  const key = `${version}/${profile}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { run, result } = getSchemas(version, profile);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);

  const compiled: CompiledSchemas = {
    run: ajv.compile(run),
    result: ajv.compile(result),
  };
  cache.set(key, compiled);
  return compiled;
}
