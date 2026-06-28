import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// The viewer lives at design/web/ and reads sibling content under design/
// (decisions, contract, schemas, README) via import.meta.glob with ../ paths.
// We must allow Vite's dev file-server to read those parent dirs.
const webRoot = fileURLToPath(new URL('.', import.meta.url))
const designRoot = fileURLToPath(new URL('..', import.meta.url))

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [webRoot, designRoot],
    },
  },
})
