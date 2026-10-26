import { LineCounter, parse, parseDocument, stringify } from "yaml";
import type { Document } from "yaml";

export function parseYaml(raw: string): unknown {
  return parse(raw);
}

/** Serialize a plain value to YAML (for generated files, e.g. the failure index). */
export function stringifyYaml(value: unknown): string {
  return stringify(value);
}

export function parseDoc(raw: string): Document.Parsed {
  return parseDocument(raw);
}

export function stringifyDoc(doc: Document.Parsed): string {
  return doc.toString();
}

/** Parse keeping source positions, so callers can report a line and column. */
export function parseDocWithLines(raw: string): { doc: Document.Parsed; lines: LineCounter } {
  const lines = new LineCounter();
  return { doc: parseDocument(raw, { lineCounter: lines }), lines };
}
