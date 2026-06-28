import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// The viewer lives at design/web/ and reads sibling content under design/
// (decisions, contract, schemas, README) via import.meta.glob with ../ paths.
// We must allow Vite's dev file-server to read those parent dirs.
const webRoot = fileURLToPath(new URL('.', import.meta.url))
const designRoot = fileURLToPath(new URL('..', import.meta.url))
// The L0 schemas now live at <repo>/src/schemas/0.1/L0 (decision 0038), outside
// design/, so the dev file-server must also be allowed to read the repo root.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [webRoot, designRoot, repoRoot],
    },
  },
})
