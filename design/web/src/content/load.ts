import yaml from 'js-yaml'
import { parseFrontmatter } from './frontmatter'
import type {
  Decision,
  DecisionOption,
  ContractPage,
  SchemaDoc,
  JSONSchema,
  Feature,
} from '../types'

// ---------------------------------------------------------------------------
// Sibling content is loaded at build/dev time via import.meta.glob.
// Paths are relative to THIS module (design/web/src/content/load.ts):
//   ../../../decisions          -> design/decisions
//   ../../../contract           -> design/contract
//   ../../../../src/schemas/0.1/L0 -> src/schemas/0.1/L0 (canonical home, decision 0038)
//   ../../../README.md          -> design/README.md
// Every glob may return 0..N entries — the app must never crash on absence.
// ---------------------------------------------------------------------------

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function asNumberArray(v: unknown): number[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'number' ? x : Number(x)))
    .filter((x) => Number.isFinite(x))
}

// --- Decisions -------------------------------------------------------------

const decisionFiles = import.meta.glob('../../../decisions/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function parseOptions(raw: unknown): DecisionOption[] {
  if (!Array.isArray(raw)) return []
  return raw.map((o, i) => {
    const obj = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
    return {
      id: asString(obj.id) ?? `option-${i + 1}`,
      summary: asString(obj.summary) ?? '',
      chosen: obj.chosen === true,
    }
  })
}

export function loadDecisions(): Decision[] {
  const decisions: Decision[] = Object.entries(decisionFiles).map(
    ([path, raw]) => {
      const file = basename(path)
      const { data, body } = parseFrontmatter(raw)
      const numericFromName = Number.parseInt(file, 10)
      const id =
        typeof data.id === 'number'
          ? data.id
          : Number.isFinite(Number(data.id))
            ? Number(data.id)
            : Number.isFinite(numericFromName)
              ? numericFromName
              : 0
      const supersedes = Array.isArray(data.supersedes)
        ? (data.supersedes as (string | number)[])
        : []
      return {
        id,
        slug: asString(data.slug) ?? file.replace(/\.md$/, ''),
        title: asString(data.title) ?? file,
        status: asString(data.status) ?? 'proposed',
        date: asString(data.date),
        proposition: asString(data.proposition),
        options: parseOptions(data.options),
        decision: asString(data.decision),
        governs: asStringArray(data.governs),
        supersedes,
        feature: asStringArray(data.feature),
        dependsOn: asNumberArray(data.depends_on),
        body,
        file,
      }
    },
  )
  decisions.sort((a, b) => a.id - b.id)
  return decisions
}

// --- Contract pages --------------------------------------------------------

const contractFiles = import.meta.glob('../../../contract/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function loadContractPages(): ContractPage[] {
  const pages: ContractPage[] = Object.entries(contractFiles).map(
    ([path, raw]) => {
      const file = basename(path)
      const { data, body } = parseFrontmatter(raw)
      const order =
        typeof data.order === 'number'
          ? data.order
          : Number.isFinite(Number(data.order))
            ? Number(data.order)
            : 1000
      return {
        title: asString(data.title) ?? file.replace(/\.md$/, ''),
        order,
        body,
        file,
        slug: file.replace(/\.md$/, ''),
      }
    },
  )
  pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title))
  return pages
}

// --- Schemas ---------------------------------------------------------------

const schemaFiles = import.meta.glob('../../../../src/schemas/0.1/L0/*.json', {
  eager: true,
  import: 'default',
}) as Record<string, JSONSchema>

export function loadSchemas(): SchemaDoc[] {
  const docs: SchemaDoc[] = Object.entries(schemaFiles).map(
    ([path, schema]) => ({
      file: basename(path),
      schema,
    }),
  )
  docs.sort((a, b) => a.file.localeCompare(b.file))
  return docs
}

// --- README (landing narrative) -------------------------------------------

const readmeFiles = import.meta.glob('../../../README.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function loadReadme(): string | null {
  const first = Object.values(readmeFiles)[0]
  const trimmed = (first ?? '').trim()
  // A near-empty README (just a title) is not a useful narrative.
  if (trimmed.length < 24) return null
  return first ?? null
}

// --- Features (decision-graph spec-area nodes) -----------------------------

const featureFiles = import.meta.glob('../../../features.yaml', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export function loadFeatures(): Feature[] {
  const raw = Object.values(featureFiles)[0]
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = yaml.load(raw)
  } catch {
    return []
  }
  const list = (parsed as { features?: unknown })?.features
  if (!Array.isArray(list)) return []
  return list
    .map((f) => {
      const obj = (f && typeof f === 'object' ? f : {}) as Record<string, unknown>
      return {
        id: asString(obj.id) ?? '',
        title: asString(obj.title) ?? asString(obj.id) ?? '',
        blurb: asString(obj.blurb),
        spec: asString(obj.spec),
      }
    })
    .filter((f) => f.id.length > 0)
}
