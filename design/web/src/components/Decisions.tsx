import { useEffect, type MouseEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { loadDecisions } from '../content/load'
import { DecisionCard } from './DecisionCard'

export function Decisions() {
  const decisions = loadDecisions()
  const location = useLocation()

  // Arriving from a spec key ("click a key → its decision"): scroll to the
  // decision the spec view handed off via navigation state.
  useEffect(() => {
    const target = (location.state as { decision?: number } | null)?.decision
    if (typeof target !== 'number') return
    const el = document.getElementById(`decision-${target}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.state])

  // In-app navigation for links between decision files, e.g.
  // [single source of truth](0024-...md) -> scroll to that decision card.
  // Never break: unknown / not-yet-written targets are simply no-ops.
  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') ?? ''
    if (/^(https?:|mailto:)/i.test(href)) return
    const m = href.match(/(\d+)[^/]*\.md(?:#.*)?$/i)
    if (!m) return
    e.preventDefault()
    const id = Number.parseInt(m[1], 10)
    const el = document.getElementById(`decision-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="shell">
      <div className="page-head">
        <div className="page-kicker">decision log</div>
        <h2>Why the format is the way it is</h2>
        <p>
          Every part of evidence-cli starts as a decision record: the question,
          the options weighed, the choice, and the reasoning. No code lands
          without one. Links between decisions navigate in-app.
        </p>
      </div>

      <div onClick={handleClick}>
        {decisions.length === 0 ? (
          <div className="empty">
            No decisions found in design/decisions/. Add NNNN-slug.md files to
            populate this log.
          </div>
        ) : (
          decisions.map((d) => <DecisionCard decision={d} key={d.file} />)
        )}
      </div>

      <div className="footer">
        <span>design/decisions/*.md</span>
        <span>{decisions.length} decision(s)</span>
      </div>
    </div>
  )
}
