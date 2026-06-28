import { Routes, Route, Navigate } from 'react-router-dom'
import { Nav } from './components/Nav'
import { Landing } from './components/Landing'
import { Contract } from './components/Contract'
import { Decisions } from './components/Decisions'

export default function App() {
  return (
    <>
      <Nav />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/contract" element={<Contract />} />
        <Route path="/decisions" element={<Decisions />} />
        {/* /map (the node graph) was retired in favor of the spec-centric
            contract view — decision 0032. Redirect any stale link. */}
        <Route path="/map" element={<Navigate to="/contract" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
