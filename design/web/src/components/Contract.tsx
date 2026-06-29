import type { MouseEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  loadContractPages,
  loadSchemas,
  loadDecisions,
  loadProfiles,
} from '../content/load'
import { renderMarkdown } from '../content/markdown'
import { buildGovernsIndex } from '../content/governs'
import type { Decision, Profile } from '../types'
import { SchemaTable } from './SchemaTable'

function scrollToProfile(id: string) {
  document
    .getElementById(`profile-${id}`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// The contract is an additive ladder: each profile KEEPS everything below it and
// adds more. Render it as nested boxes — the highest profile on the outside,
// wrapping the ones it includes — so "L1 = L0 + more" reads literally.
function ProfileLadder({ profiles }: { profiles: Profile[] }) {
  let box: ReactNode = null
  for (const p of profiles) {
    const inner = box
    box = (
      <div className="ladder-box" key={p.id}>
        <div className="ladder-head">
          <span className="ladder-id">{p.id}</span>
          <span className="ladder-title">{p.title}</span>
          {p.extends && <span className="ladder-plus">= {p.extends} + more</span>}
        </div>
        {p.adds && <div className="ladder-adds">{p.adds}</div>}
        {inner}
      </div>
    )
  }
  return (
    <div className="profile-ladder">
      <div className="ladder-caption">
        one <code>0.1</code> contract · each layer includes everything inside it
      </div>
      {box}
    </div>
  )
}

export function Contract() {
  const pages = loadContractPages()
  const schemas = loadSchemas()
  const decisions = loadDecisions()
  const index = buildGovernsIndex(decisions)
  const navigate = useNavigate()

  // Profile order comes from profiles.yaml; append any profile that appears in
  // pages/schemas but isn't declared, so nothing is silently hidden.
  const declared = loadProfiles()
  const declaredIds = new Set(declared.map((p) => p.id))
  const extraIds = [
    ...new Set([
      ...pages.map((p) => p.profile),
      ...schemas.map((s) => s.profile),
    ]),
  ].filter((id): id is string => !!id && !declaredIds.has(id))
  const profiles: Profile[] = [
    ...declared,
    ...extraIds.map((id) => ({ id, title: id })),
  ]

  const pagesFor = (p: Profile) => pages.filter((pg) => pg.profile === p.id)
  const schemasFor = (p: Profile) => schemas.filter((s) => s.profile === p.id)

  // Decisions that shaped a profile: those governing its schema directory or any
  // of its contract pages. (Field-level decisions still attach inside each table.)
  const decisionsFor = (p: Profile): Decision[] => {
    const tokens = [
      `src/schemas/0.1/${p.id}`,
      ...pagesFor(p).map((pg) => `design/contract/${pg.file}`),
    ]
    const byId = new Map<number, Decision>()
    for (const tok of tokens) {
      for (const d of index.forToken(tok)) byId.set(d.id, d)
    }
    return [...byId.values()].sort((a, b) => a.id - b.id)
  }

  // A decision card / link rendered inline can reference another decision by
  // filename (e.g. 0024-...md). Intercept and hand off to the decisions log.
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
          The format is a ladder of <b>profiles</b> on one <code>0.1</code>{' '}
          contract. <b>L0</b> is the minimal, framework-neutral core; each higher
          profile is <b>purely additive</b> — <b>L1 keeps everything in L0</b> and
          adds the evidence-artifact layer. Schema tables are generated from{' '}
          <code>src/schemas/0.1/&lt;profile&gt;/</code> — the same files the
          validator uses. <b>Every key a decision shaped is clickable.</b>
        </p>
      </div>

      {profiles.length > 0 && <ProfileLadder profiles={profiles} />}

      {profiles.map((p) => {
        const profPages = pagesFor(p)
        const profSchemas = schemasFor(p)
        const profDecisions = decisionsFor(p)
        return (
          <section
            className="profile-section"
            id={`profile-${p.id}`}
            key={p.id}
          >
            <div className="profile-section-head">
              <h2>
                <span className="profile-chip">{p.id}</span> {p.title}
              </h2>
              {p.extends && (
                <button
                  className="extends-badge"
                  onClick={() => scrollToProfile(p.extends as string)}
                  title={`L1 keeps everything in ${p.extends}`}
                >
                  includes all of {p.extends} ↑
                </button>
              )}
            </div>

            {p.blurb && <p className="profile-blurb">{p.blurb}</p>}

            {profDecisions.length > 0 && (
              <div className="profile-decisions">
                <span className="pd-label">shaped by</span>
                {profDecisions.map((d) => (
                  <button
                    className="govchip"
                    key={d.id}
                    onClick={() =>
                      navigate('/decisions', { state: { decision: d.id } })
                    }
                  >
                    {String(d.id).padStart(4, '0')} · {d.title}
                  </button>
                ))}
              </div>
            )}

            {profPages.map((pg) => (
              <article
                key={pg.file}
                className="prose"
                style={{ marginTop: 20 }}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(pg.body) }}
              />
            ))}

            {profSchemas.length > 0 && (
              <>
                <div className="section-title">
                  {p.id} schemas — click a key for its decisions
                </div>
                {profSchemas.map((doc) => (
                  <SchemaTable doc={doc} index={index} key={doc.file} />
                ))}
              </>
            )}
          </section>
        )
      })}

      <div className="footer">
        <span>
          generated from src/schemas/0.1/*/*.json + design/contract/*.md +
          design/decisions/*.md
        </span>
        <span>
          {profiles.length} profiles · {schemas.length} schema(s) ·{' '}
          {decisions.length} decisions
        </span>
      </div>
    </div>
  )
}
