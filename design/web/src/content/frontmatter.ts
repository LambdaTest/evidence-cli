import yaml from 'js-yaml'

export interface ParsedMarkdown {
  data: Record<string, unknown>
  body: string
}

const FRONTMATTER_RE = /^﻿?---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n)?/

/**
 * Browser-safe frontmatter splitter. We deliberately avoid gray-matter
 * (needs Node's Buffer). Split the leading `---...---` block ourselves and
 * parse it with js-yaml.
 */
export function parseFrontmatter(raw: string): ParsedMarkdown {
  const match = raw.match(FRONTMATTER_RE)
  if (!match) {
    return { data: {}, body: raw }
  }
  let data: Record<string, unknown> = {}
  try {
    const parsed = yaml.load(match[1])
    if (parsed && typeof parsed === 'object') {
      data = parsed as Record<string, unknown>
    }
  } catch {
    data = {}
  }
  const body = raw.slice(match[0].length)
  return { data, body }
}
