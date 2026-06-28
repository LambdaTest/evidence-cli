import { useState } from 'react'
import type { FieldNode, SchemaDoc } from '../types'
import { buildSchemaFields, rootFlags } from '../content/schema-fields'
import type { GovernsIndex } from '../content/governs'
import { DecisionCard } from './DecisionCard'

const ROOT = '__root__'

function reqLabel(node: FieldNode): string {
  if (node.required.kind === 'yes') return 'required'
  if (node.required.kind === 'conditional') return 'conditional'
  return 'optional'
}

function FieldRow({
  node,
  file,
  index,
  selected,
  onToggle,
}: {
  node: FieldNode
  file: string
  index: GovernsIndex
  selected: string | null
  onToggle: (pointer: string) => void
}) {
  const enumValues = node.enumValues ?? []
  const decisions = index.forField(file, node.pointer)
  const hasDec = decisions.length > 0
  const open = selected === node.pointer

  return (
    <div className={`frow${hasDec ? ' has-dec' : ''}${open ? ' open' : ''}`}>
      <div
        className="frow-main"
        role={hasDec ? 'button' : undefined}
        tabIndex={hasDec ? 0 : undefined}
        onClick={hasDec ? () => onToggle(node.pointer) : undefined}
        onKeyDown={
          hasDec
            ? (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onToggle(node.pointer)
                }
              }
            : undefined
        }
      >
        <span className={`fname${node.name === '«any key»' ? ' anykey' : ''}`}>
          {node.name}
        </span>
        <span className="ftype">{node.typeLabel}</span>
        <span className={`freq ${node.required.kind}`}>{reqLabel(node)}</span>
        {hasDec && (
          <span className="fwhy" title="decisions that shaped this key">
            {open ? '▾' : '▸'} {decisions.length} decision
            {decisions.length > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {node.description && <div className="fdesc">{node.description}</div>}

      {(node.required.kind === 'conditional' && node.required.note) ||
      node.constValue !== undefined ||
      enumValues.length > 0 ||
      node.constraints.length > 0 ? (
        <div className="fmeta">
          {node.required.kind === 'conditional' && node.required.note && (
            <span className="pill cond">{node.required.note}</span>
          )}
          {node.constValue !== undefined && (
            <span className="pill constv">
              const: {JSON.stringify(node.constValue)}
            </span>
          )}
          {enumValues.map((v, i) => (
            <span className="pill enumv" key={i}>
              {typeof v === 'string' ? v : JSON.stringify(v)}
            </span>
          ))}
          {node.constraints.map((c, i) => (
            <span className="pill" key={`c-${i}`}>
              {c}
            </span>
          ))}
        </div>
      ) : null}

      {open && hasDec && (
        <div className="field-decisions">
          {decisions.map((d) => (
            <DecisionCard decision={d} key={d.file} />
          ))}
        </div>
      )}

      {node.children.length > 0 && (
        <>
          {node.childrenLabel && (
            <div className="fchildren-label">{node.childrenLabel}</div>
          )}
          <div className="fchildren">
            {node.children.map((child, i) => (
              <FieldRow
                node={child}
                file={file}
                index={index}
                selected={selected}
                onToggle={onToggle}
                key={`${child.name}-${i}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export function SchemaTable({
  doc,
  index,
}: {
  doc: SchemaDoc
  index: GovernsIndex
}) {
  const fields = buildSchemaFields(doc.schema)
  const flags = rootFlags(doc.schema)
  const rootDecisions = index.forSchemaRoot(doc.file)
  const [selected, setSelected] = useState<string | null>(null)
  const toggle = (p: string) => setSelected((cur) => (cur === p ? null : p))

  return (
    <div className="schema-card">
      <div className="schema-card-head">
        <div className="file">{doc.file}</div>
        {doc.schema.title && <h3>{doc.schema.title}</h3>}
        {doc.schema.description && (
          <div className="desc">{doc.schema.description}</div>
        )}
        {flags.length > 0 && (
          <div className="schema-flags">
            {flags.map((f, i) => (
              <span className="flag" key={i}>
                {f}
              </span>
            ))}
          </div>
        )}
        {rootDecisions.length > 0 && (
          <div className="schema-root-dec">
            <button
              className={`fwhy btn${selected === ROOT ? ' open' : ''}`}
              onClick={() => toggle(ROOT)}
            >
              {selected === ROOT ? '▾' : '▸'} shaped by {rootDecisions.length}{' '}
              decision{rootDecisions.length > 1 ? 's' : ''}
            </button>
            {selected === ROOT && (
              <div className="field-decisions">
                {rootDecisions.map((d) => (
                  <DecisionCard decision={d} key={d.file} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="fields">
        {fields.length === 0 ? (
          <div className="empty">No fields defined.</div>
        ) : (
          fields.map((node, i) => (
            <FieldRow
              node={node}
              file={doc.file}
              index={index}
              selected={selected}
              onToggle={toggle}
              key={`${node.name}-${i}`}
            />
          ))
        )}
      </div>
    </div>
  )
}
