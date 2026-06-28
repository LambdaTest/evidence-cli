import type { Diagnostic } from "./contract";

export function err(code: string, location: string, message: string): Diagnostic {
  return { code, severity: "error", location, message };
}

export function warn(code: string, location: string, message: string): Diagnostic {
  return { code, severity: "warning", location, message };
}
