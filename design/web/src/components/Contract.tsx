import type { MouseEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { loadContractPages, loadSchemas, loadDecisions } from '../content/load'
import { renderMarkdown } from '../content/markdown'
import { buildGovernsIndex } from '../content/governs'
import { SchemaTable } from './SchemaTable'

export function Contract() {
  const pages = loadContractPages()
  const schemas = loadSchemas()
  const decisions = loadDecisions()
  const index = buildGovernsIndex(decisions)
  const navigate = useNavigate()

  // A decision card rendered inline can link to other decisions by filename
  // (e.g. 0024-...md). Those are not routes — intercept them and hand off to the
  // full decisions log, scrolled to the target. Route links (#/decisions) and
  // external links are left alone.
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (/^(https?:|mailto:|#)/i.test(href)) return
    const m = href.match(/(\d+)[^/]*\.md(?:#.*)?$/i)
    if (!m) return
    e.preventDefault()
    navigate('/decisions', { state: { decision: Number.parseInt(m[1], 10) } })
  }

  return (
    <div className="shell" onClick={handleClick}>
      <div className="page-head">
        <div className="page-kicker">the spec</div>
        <h2>What an .evidence pack must contain</h2>
        <p>
          The L0 contract is the minimum, framework-neutral shape every pack
          conforms to. The prose pages are the narrative; the schema tables are
          generated directly from the JSON Schemas in{' '}
          <code>src/schemas/0.1/L0/</code> — the same files the validator uses.{' '}
          <b>Every key that a decision shaped is clickable</b>: select it to read
          the decision(s) behind it, right here.
        </p>
      </div>

      {pages.length > 0 && (
        <section>
          {pages.map((p) => (
            <article key={p.file} style={{ marginTop: 28 }}>
              <div
                className="prose"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(p.body) }}
              />
            </article>
          ))}
        </section>
      )}

      <div className="section-title">L0 Schemas — click a key for its decisions</div>
      {schemas.length === 0 ? (
        <div className="empty">
          No schemas found in src/schemas/0.1/L0/. Add *.json files to populate
          this section.
        </div>
      ) : (
        schemas.map((doc) => (
          <SchemaTable doc={doc} index={index} key={doc.file} />
        ))
      )}

      {pages.length === 0 && (
        <p style={{ color: 'var(--faint)', marginTop: 28, fontSize: 13 }}>
          No prose contract pages yet (design/contract/*.md). The schemas above
          are the live source of truth.
        </p>
      )}

      <div className="footer">
        <span>generated from src/schemas/0.1/L0/*.json + design/decisions/*.md</span>
        <span>
          {schemas.length} schema(s) · {decisions.length} decisions
        </span>
      </div>
    </div>
  )
}
