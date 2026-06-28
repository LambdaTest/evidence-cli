import type { DecisionStatus } from '../types'

const KNOWN = new Set(['accepted', 'proposed', 'superseded'])

export function StatusBadge({ status }: { status: DecisionStatus }) {
  const cls = KNOWN.has(status) ? status : 'neutral'
  return <span className={`badge ${cls}`}>{status}</span>
}
