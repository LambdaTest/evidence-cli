import { Marked } from 'marked'

// First-party content; a fresh Marked instance keeps config local & predictable.
const marked = new Marked({
  gfm: true,
  breaks: false,
})

export function renderMarkdown(md: string): string {
  if (!md) return ''
  return marked.parse(md, { async: false }) as string
}
