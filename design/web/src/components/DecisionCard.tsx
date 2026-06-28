import { renderMarkdown } from '../content/markdown'
import { StatusBadge } from './Badge'
import type { Decision } from '../types'

/**
 * One decision rendered as proposition → options → decision → reasoning.
 * Shared by the decisions log and the spec-centric view (a key links here).
 */
export function DecisionCard({ decision }: { decision: Decision }) {
  const d = decision
  const superseded = d.status === 'superseded'
  return (
    <article
      className={`decision${superseded ? ' superseded' : ''}`}
      id={`decision-${d.id}`}
    >
      <div className="decision-head">
        <span className="decision-id">#{String(d.id).padStart(4, '0')}</span>
        <h3>{d.title}</h3>
        <StatusBadge status={d.status} />
      </div>

      {d.proposition && (
        <>
          <div className="field-label">Proposition</div>
          <div className="proposition">{d.proposition.trim()}</div>
        </>
      )}

      {d.options.length > 0 && (
        <>
          <div className="field-label">Options weighed</div>
          <div className="options">
            {d.options.map((o) => (
              <div
                className={`option ${o.chosen ? 'chosen' : 'notchosen'}`}
                key={o.id}
              >
                <span className="mark">{o.chosen ? '✓' : '·'}</span>
                <span>
                  <span className="oid">{o.id}</span>
                  {o.summary && <span className="osum"> — {o.summary}</span>}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {d.decision && (
        <>
          <div className="field-label">Decision</div>
          <div className="decision-statement">{d.decision.trim()}</div>
        </>
      )}

      {d.governs.length > 0 && (
        <>
          <div className="field-label">Governs</div>
          <div className="governs-row">
            {d.governs.map((g) => (
              <span className="govchip" key={g}>
                {g}
              </span>
            ))}
          </div>
        </>
      )}

      {d.body.trim() && (
        <div
          className="prose"
          style={{ marginTop: 18 }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(d.body) }}
        />
      )}
    </article>
  )
}
