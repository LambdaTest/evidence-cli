import { Link } from 'react-router-dom'
import { loadReadme, loadProfiles } from '../content/load'
import { renderMarkdown } from '../content/markdown'

const L0_FILES = [
  { k: 'manifest', v: 'run.yaml' },
  { k: 'per-test', v: 'result.yaml' },
  { k: 'pack', v: '.evidence' },
]

const FEATURES = [
  {
    tag: 'neutral',
    title: 'Knows nothing about your framework',
    body: 'The per-test definition is referenced and hashed, never parsed. kane test.md, a .spec.ts, an API suite — treated identically.',
  },
  {
    tag: 'additive',
    title: 'A ladder of profiles, one contract',
    body: 'L0 is the minimal shape every pack conforms to. Higher profiles only add — L1 keeps all of L0 and brings the captured evidence artifacts (logs, screenshots, coverage). The 0.1 contract never gets rewritten.',
  },
  {
    tag: 'self-hosted',
    title: 'The repo IS the spec',
    body: 'Decisions, contract, and the JSON Schemas live in the repo. The validator and these docs render the same files — drift is impossible, not just discouraged.',
  },
]

export function Landing() {
  const readme = loadReadme()
  const profiles = loadProfiles()
  return (
    <div className="shell">
      <section className="hero">
        <span className="eyebrow">evidence format · L0 → L1</span>
        <h1>
          Evidence for <span className="grad">ANY</span> test framework.
        </h1>
        <p className="lede">
          An open, framework-agnostic format for test results. evidence-cli
          knows nothing about how your tests are written — it records what
          happened, in one neutral shape, so any tool can read it.
        </p>

        <div className="install">
          <span className="prompt">$</span>
          <span>
            npm i -g <span className="pkg">evidence-cli</span>
          </span>
          <span className="copy">// then `evidence finalize`</span>
        </div>

        <div className="chips">
          {L0_FILES.map((c) => (
            <span className="chip" key={c.v}>
              <span className="k">{c.k}</span>
              {c.v}
            </span>
          ))}
        </div>

        {profiles.length > 0 && (
          <div className="chips" style={{ marginTop: 14 }}>
            {profiles.map((p) => (
              <span className="chip" key={p.id}>
                <span className="k">{p.id}</span>
                {p.extends ? `= ${p.extends} + ${p.title.toLowerCase()}` : p.title.toLowerCase()}
              </span>
            ))}
          </div>
        )}

        <div className="chips" style={{ marginTop: 18 }}>
          <Link
            to="/contract"
            className="chip"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            read the contract →
          </Link>
          <Link
            to="/decisions"
            className="chip"
            style={{ borderColor: 'var(--border-strong)' }}
          >
            why it is the way it is →
          </Link>
        </div>
      </section>

      <section className="feature-grid">
        {FEATURES.map((f) => (
          <div className="feature" key={f.title}>
            <div className="tag">{f.tag}</div>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </div>
        ))}
      </section>

      {readme && (
        <section className="readme-block">
          <div
            className="prose"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(readme) }}
          />
        </section>
      )}

      <div className="footer">
        <span>evidence-cli · design viewer</span>
        <span>the repo is the spec</span>
      </div>
    </div>
  )
}
