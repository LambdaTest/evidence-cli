import type { Decision } from '../types'

// ---------------------------------------------------------------------------
// Reverse index of the decisions' `governs` pointers, so the spec view can ask
// "which decisions shaped THIS key?" — the inverse of the decision → artifact
// link. This is what makes the viewer spec-centric (decision 0032): the same
// `governs` data the retired node graph used, indexed the other way.
// ---------------------------------------------------------------------------

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

/**
 * Normalize a `governs` entry into lookup tokens.
 *   design/schemas/L0/run.schema.json#/properties/totals
 *     -> "run.schema.json#/properties/totals"
 *   design/contract/03-commands.md
 *     -> "design/contract/03-commands.md"
 *   design/schemas/L0/run.schema.json
 *     -> "design/schemas/L0/run.schema.json" AND "run.schema.json"
 */
function tokensFor(governs: string): string[] {
  const hash = governs.indexOf('#')
  if (hash >= 0) {
    const file = governs.slice(0, hash)
    const pointer = governs.slice(hash + 1) // keeps leading '/'
    return [`${basename(file)}#${pointer}`]
  }
  const toks = [governs]
  if (governs.endsWith('.schema.json')) toks.push(basename(governs))
  return toks
}

export interface GovernsIndex {
  /** decisions governing a schema field, keyed `<file>#<pointer>` */
  forField(schemaFile: string, pointer: string): Decision[]
  /** decisions governing a whole schema file (root / #/required / #/allOf) */
  forSchemaRoot(schemaFile: string): Decision[]
  /** decisions governing an artifact/area path or token */
  forToken(token: string): Decision[]
}

export function buildGovernsIndex(decisions: Decision[]): GovernsIndex {
  const map = new Map<string, Decision[]>()
  const add = (key: string, d: Decision) => {
    const arr = map.get(key)
    if (arr) {
      if (!arr.includes(d)) arr.push(d)
    } else map.set(key, [d])
  }
  for (const d of decisions) {
    for (const g of d.governs) {
      for (const tok of tokensFor(g)) add(tok, d)
    }
  }
  const get = (key: string): Decision[] => {
    const arr = map.get(key)
    return arr ? [...arr].sort((a, b) => a.id - b.id) : []
  }
  return {
    forField: (file, pointer) => get(`${file}#${pointer}`),
    forSchemaRoot: (file) => {
      const seen = new Set<number>()
      const out: Decision[] = []
      for (const key of [file, `${file}#/required`, `${file}#/allOf`]) {
        for (const d of get(key)) {
          if (!seen.has(d.id)) {
            seen.add(d.id)
            out.push(d)
          }
        }
      }
      return out.sort((a, b) => a.id - b.id)
    },
    forToken: (token) => get(token),
  }
}
