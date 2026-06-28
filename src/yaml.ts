import { parse, parseDocument } from "yaml";
import type { Document } from "yaml";

export function parseYaml(raw: string): unknown {
  return parse(raw);
}

export function parseDoc(raw: string): Document.Parsed {
  return parseDocument(raw);
}

export function stringifyDoc(doc: Document.Parsed): string {
  return doc.toString();
}
