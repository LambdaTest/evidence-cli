import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type { ValidateFunction } from "ajv";
import { getSchemas, getL1Schemas } from "./registry";

export interface CompiledSchemas {
  run: ValidateFunction;
  result: ValidateFunction;
}

export interface CompiledL1Schemas {
  logsMeta: ValidateFunction;
  video: ValidateFunction;
  failure: ValidateFunction;
  failureIndex: ValidateFunction;
}

const cache = new Map<string, CompiledSchemas>();
const l1Cache = new Map<string, CompiledL1Schemas>();

function newAjv(): Ajv2020 {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  return ajv;
}

export function loadSchemas(version: string, profile: string): CompiledSchemas {
  const key = `${version}/${profile}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const { run, result } = getSchemas(version, profile);
  const ajv = newAjv();
  const compiled: CompiledSchemas = {
    run: ajv.compile(run),
    result: ajv.compile(result),
  };
  cache.set(key, compiled);
  return compiled;
}

export function loadL1Schemas(version: string): CompiledL1Schemas {
  const hit = l1Cache.get(version);
  if (hit) return hit;

  const { logsMeta, video, failure, failureIndex } = getL1Schemas(version);
  const ajv = newAjv();
  const compiled: CompiledL1Schemas = {
    logsMeta: ajv.compile(logsMeta),
    video: ajv.compile(video),
    failure: ajv.compile(failure),
    failureIndex: ajv.compile(failureIndex),
  };
  l1Cache.set(version, compiled);
  return compiled;
}
