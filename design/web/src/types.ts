export type DecisionStatus = 'proposed' | 'accepted' | 'superseded' | string

export interface DecisionOption {
  id: string
  summary: string
  chosen: boolean
}

export interface Decision {
  id: number
  slug: string
  title: string
  status: DecisionStatus
  date?: string
  proposition?: string
  options: DecisionOption[]
  decision?: string
  governs: string[]
  supersedes: (string | number)[]
  /** Feature/spec-area slugs this decision produces (graph: decision → feature). */
  feature: string[]
  /** Ids of decisions this one builds on (graph: dep → this). */
  dependsOn: number[]
  /** Raw markdown body after frontmatter. */
  body: string
  /** Source filename, e.g. 0001-decisions-gate-code.md */
  file: string
}

/** A capability / spec-area node, defined in design/features.yaml. */
export interface Feature {
  id: string
  title: string
  blurb?: string
  /** path (optionally with #fragment) of the spec this feature lands in */
  spec?: string
}

/** A profile on the contract ladder, defined in design/profiles.yaml. */
export interface Profile {
  id: string
  title: string
  /** the profile this one builds on (its base); absent for the minimal core */
  extends?: string
  blurb?: string
  /** short hint of what this layer adds, for the ladder display */
  adds?: string
}

export interface ContractPage {
  title: string
  order: number
  body: string
  file: string
  slug: string
  /** profile this page documents (frontmatter), e.g. L0 / L1 */
  profile?: string
}

export interface SchemaDoc {
  /** filename, e.g. run.schema.json */
  file: string
  /** raw parsed JSON Schema */
  schema: JSONSchema
  /** profile the schema belongs to, derived from its src/schemas/0.1/<profile>/ path */
  profile?: string
}

/** Intentionally loose — JSON Schema is dynamic. */
export interface JSONSchema {
  $schema?: string
  $id?: string
  title?: string
  description?: string
  type?: string | string[]
  const?: unknown
  enum?: unknown[]
  format?: string
  pattern?: string
  minLength?: number
  maxLength?: number
  minimum?: number
  maximum?: number
  required?: string[]
  properties?: Record<string, JSONSchema>
  additionalProperties?: boolean | JSONSchema
  items?: JSONSchema
  $ref?: string
  $defs?: Record<string, JSONSchema>
  allOf?: JSONSchema[]
  [k: string]: unknown
}

export type RequiredKind = 'yes' | 'no' | 'conditional'

export interface RequiredInfo {
  kind: RequiredKind
  /** human note for conditional, e.g. "required when status = finalized" */
  note?: string
}

export interface FieldNode {
  name: string
  typeLabel: string
  required: RequiredInfo
  description?: string
  enumValues?: unknown[]
  constValue?: unknown
  constraints: string[]
  /** label describing the relationship of children to this node */
  childrenLabel?: string
  children: FieldNode[]
  /**
   * JSON Pointer of this node within its schema (e.g. /properties/totals,
   * /$defs/step/properties/status). Combined with the schema filename it forms
   * the `governs` key used to find the decisions that shaped this key.
   */
  pointer: string
}
