import type { FieldNode, JSONSchema, RequiredInfo } from '../types'

// ---------------------------------------------------------------------------
// Turn a JSON Schema (draft 2020-12) into a recursive tree of FieldNodes that
// the UI can render as a human-friendly field table:
//   name · type · required(yes/no/conditional) · description · constraints
// Handles: nested objects, array items, $ref (#/$defs/...), enum/const,
// additionalProperties-as-schema (open maps like `metrics`), and allOf if/then
// conditional requirements (e.g. "required when status = finalized").
// ---------------------------------------------------------------------------

function isSchema(v: unknown): v is JSONSchema {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function formatValue(v: unknown): string {
  if (typeof v === 'string') return `"${v}"`
  return JSON.stringify(v)
}

function resolveRef(root: JSONSchema, ref: string): JSONSchema | undefined {
  if (!ref.startsWith('#/')) return undefined
  const parts = ref.slice(2).split('/')
  let cur: unknown = root
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p]
    } else {
      return undefined
    }
  }
  return isSchema(cur) ? cur : undefined
}

function jsonType(schema: JSONSchema): string | undefined {
  const t = schema.type
  if (Array.isArray(t)) return t.join(' | ')
  return typeof t === 'string' ? t : undefined
}

function typeLabelFor(
  schema: JSONSchema,
  refName: string | undefined,
): string {
  if (refName) return `${jsonType(schema) ?? 'object'} · ${refName}`
  if ('const' in schema) return 'const'
  if (Array.isArray(schema.enum)) return 'enum'
  const t = schema.type
  if (Array.isArray(t)) return t.join(' | ')
  if (t === 'array') {
    const item = schema.items
    if (isSchema(item)) {
      if (typeof item.$ref === 'string') return `array<${item.$ref.split('/').pop()}>`
      return `array<${jsonType(item) ?? 'any'}>`
    }
    return 'array'
  }
  if (t === 'object') {
    if (
      !schema.properties &&
      schema.additionalProperties &&
      typeof schema.additionalProperties === 'object'
    ) {
      return 'object · open map'
    }
    return 'object'
  }
  return typeof t === 'string' ? t : 'any'
}

function constraintsFor(schema: JSONSchema): string[] {
  const c: string[] = []
  if (typeof schema.minLength === 'number') c.push(`minLength ${schema.minLength}`)
  if (typeof schema.maxLength === 'number') c.push(`maxLength ${schema.maxLength}`)
  if (typeof schema.minimum === 'number') c.push(`min ${schema.minimum}`)
  if (typeof schema.maximum === 'number') c.push(`max ${schema.maximum}`)
  if (typeof schema.format === 'string') c.push(`format: ${schema.format}`)
  if (typeof schema.pattern === 'string') c.push(`pattern: ${schema.pattern}`)
  return c
}

function describeCondition(ifS: JSONSchema): string {
  const parts: string[] = []
  const props = ifS.properties ?? {}
  for (const [k, v] of Object.entries(props)) {
    if (!isSchema(v)) {
      parts.push(k)
      continue
    }
    if ('const' in v) parts.push(`${k} = ${formatValue(v.const)}`)
    else if (Array.isArray(v.enum))
      parts.push(`${k} ∈ {${v.enum.map(formatValue).join(', ')}}`)
    else parts.push(k)
  }
  return parts.join(' and ')
}

/** Map of field name -> human note, derived from this schema's allOf if/then. */
function extractConditionals(schema: JSONSchema): Map<string, string> {
  const map = new Map<string, string>()
  for (const entry of schema.allOf ?? []) {
    if (!isSchema(entry)) continue
    const ifS = (entry as Record<string, unknown>).if
    const thenS = (entry as Record<string, unknown>).then
    if (!isSchema(ifS) || !isSchema(thenS)) continue
    const cond = describeCondition(ifS)
    for (const f of thenS.required ?? []) {
      const note = cond ? `required when ${cond}` : 'conditionally required'
      map.set(f, map.has(f) ? `${map.get(f)}; ${note}` : note)
    }
  }
  return map
}

function objectChildren(
  schema: JSONSchema,
  root: JSONSchema,
  base: string,
): FieldNode[] {
  const required = new Set(schema.required ?? [])
  const conds = extractConditionals(schema)
  const out: FieldNode[] = []

  for (const [name, sub] of Object.entries(schema.properties ?? {})) {
    if (!isSchema(sub)) continue
    const reqInfo: RequiredInfo = conds.has(name)
      ? { kind: 'conditional', note: conds.get(name) }
      : { kind: required.has(name) ? 'yes' : 'no' }
    out.push(buildNode(name, sub, root, reqInfo, `${base}/properties/${name}`))
  }

  // additionalProperties as a schema => an open map of typed values.
  const ap = schema.additionalProperties
  if (isSchema(ap)) {
    out.push(
      buildNode('«any key»', ap, root, { kind: 'no' }, `${base}/additionalProperties`),
    )
  }

  return out
}

function buildNode(
  name: string,
  sub: JSONSchema,
  root: JSONSchema,
  required: RequiredInfo,
  pointer: string,
): FieldNode {
  let schema = sub
  let refName: string | undefined
  let refTarget: string | undefined
  if (typeof sub.$ref === 'string') {
    refName = sub.$ref.split('/').pop()
    refTarget = sub.$ref.startsWith('#') ? sub.$ref.slice(1) : undefined
    const resolved = resolveRef(root, sub.$ref)
    if (resolved) {
      schema = {
        ...resolved,
        ...(sub.description ? { description: sub.description } : {}),
      }
    }
  }

  const node: FieldNode = {
    name,
    typeLabel: typeLabelFor(schema, refName),
    required,
    description: asString(schema.description),
    enumValues: Array.isArray(schema.enum) ? schema.enum : undefined,
    constValue: 'const' in schema ? schema.const : undefined,
    constraints: constraintsFor(schema),
    children: [],
    pointer,
  }

  // The schema location whose `properties` define this node's children: the
  // $ref target if this node is a reference, else the node's own pointer. This
  // is what keeps a step field's pointer at /$defs/step/properties/… so it
  // matches the decisions' `governs` entries.
  const defBase = refTarget ?? pointer

  const isObject =
    schema.type === 'object' || (!schema.type && !!schema.properties)

  if (isObject) {
    node.children = objectChildren(schema, root, defBase)
    if (node.children.length) node.childrenLabel = 'fields'
    if (schema.additionalProperties === false)
      node.constraints.push('closed: no extra keys')
    else if (schema.additionalProperties === true)
      node.constraints.push('open: extra keys allowed')
  } else if (schema.type === 'array' && isSchema(schema.items)) {
    const item = schema.items
    const itemPointer =
      typeof item.$ref === 'string' && item.$ref.startsWith('#')
        ? item.$ref.slice(1)
        : `${pointer}/items`
    const itemNode = buildNode('items', item, root, { kind: 'no' }, itemPointer)
    node.children = itemNode.children
    if (node.children.length) node.childrenLabel = 'each item'
  }

  return node
}

export function buildSchemaFields(root: JSONSchema): FieldNode[] {
  return objectChildren(root, root, '')
}

/** Top-of-card caption flags worth surfacing (e.g. open vs closed root). */
export function rootFlags(root: JSONSchema): string[] {
  const flags: string[] = []
  if (root.additionalProperties === true) flags.push('open: extra keys allowed')
  else if (root.additionalProperties === false) flags.push('closed: no extra keys')
  if ((root.required ?? []).length)
    flags.push(`required: ${(root.required ?? []).join(', ')}`)
  return flags
}
