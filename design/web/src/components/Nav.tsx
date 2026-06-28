import { NavLink } from 'react-router-dom'

export function Nav() {
  return (
    <header className="topnav">
      <div className="topnav-inner">
        <NavLink to="/" className="brand">
          <span className="dot" />
          <span>
            evidence<span style={{ color: 'var(--faint)' }}>-</span>cli
          </span>
          <span className="mono" style={{ color: 'var(--faint)' }}>
            /design
          </span>
        </NavLink>
        <nav className="navlinks">
          <NavLink to="/" end>
            home
          </NavLink>
          <NavLink to="/contract">spec</NavLink>
          <NavLink to="/decisions">decisions</NavLink>
        </nav>
      </div>
    </header>
  )
}
