import type { ReactNode } from 'react'
import type { Source } from './api'
import { safeUrl } from './links'
import './RichText.css'

/* A tiny, safe formatter for AI replies. It understands **bold**, `code`,
   [links](https://...), plain https:// links, [1] citations, "- " bullets,
   "1. " numbered lists and "## " headings. It never uses
   dangerouslySetInnerHTML, so AI text cannot inject HTML. */

type Block =
  | { kind: 'p'; lines: string[] }
  | { kind: 'h'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }

// Cleans the most common LaTeX leftovers into readable symbols.
function tidyMath(s: string): string {
  return s
    .replace(/\\\(|\\\)|\\\[|\\\]/g, '')
    .replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\{([^{}]*)\}/g, '√($1)')
    .replace(/\\text\{([^{}]*)\}/g, '$1')
    .replace(/\\times/g, '×')
    .replace(/\\div/g, '÷')
    .replace(/\\cdot/g, '·')
    .replace(/\\neq/g, '≠')
    .replace(/\\le(?:q)?\b/g, '≤')
    .replace(/\\ge(?:q)?\b/g, '≥')
    .replace(/\\pi/g, 'π')
    .replace(/\\,/g, ' ')
}

function parseBlocks(source: string): Block[] {
  const blocks: Block[] = []
  let open = false // true while the last block can still take more lines

  for (const raw of tidyMath(source).split('\n')) {
    const line = raw.trim()

    if (!line || /^-{3,}$/.test(line)) {
      open = false
      continue
    }

    // Table rows: drop the divider row, show other rows as one plain line.
    if (line.startsWith('|') && line.endsWith('|')) {
      if (/^[\s|:-]+$/.test(line)) continue
      const text = line
        .slice(1, -1)
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .join('  ·  ')
      blocks.push({ kind: 'p', lines: [text] })
      open = false
      continue
    }

    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (heading?.[1]) {
      blocks.push({ kind: 'h', text: heading[1] })
      open = false
      continue
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/)
    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    const item = bullet?.[1] ?? numbered?.[1]
    if (item !== undefined) {
      const ordered = !bullet
      const last = blocks[blocks.length - 1]
      if (open && last && last.kind === 'list' && last.ordered === ordered) {
        last.items.push(item)
      } else {
        blocks.push({ kind: 'list', ordered, items: [item] })
      }
      open = true
      continue
    }

    const last = blocks[blocks.length - 1]
    if (open && last && last.kind === 'p') {
      last.lines.push(line)
    } else {
      blocks.push({ kind: 'p', lines: [line] })
    }
    open = true
  }

  return blocks
}

// Order matters: **bold**, `code`, [text](url), [1] citation, then plain https:// links.
const INLINE =
  /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|\[\d{1,2}\]|https?:\/\/[^\s<>"'\])]+)/g

function renderInline(text: string, sources: Source[]): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null

    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return <code key={i}>{part.slice(1, -1)}</code>
    }

    const markdownLink = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
    if (markdownLink?.[1] && markdownLink[2]) {
      const href = safeUrl(markdownLink[2])
      return href ? (
        <a key={i} href={href} target="_blank" rel="noopener noreferrer">
          {markdownLink[1]}
        </a>
      ) : (
        markdownLink[1]
      )
    }

    const citation = part.match(/^\[(\d{1,2})\]$/)
    if (citation?.[1]) {
      const source = sources[Number(citation[1]) - 1]
      const href = source ? safeUrl(source.url) : null
      return href && source ? (
        <a
          key={i}
          className="rich__cite"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={source.title}
        >
          {part}
        </a>
      ) : (
        part
      )
    }

    if (/^https?:\/\//.test(part)) {
      const trailing = part.match(/[.,;:!?]+$/)?.[0] ?? ''
      const clean = trailing ? part.slice(0, -trailing.length) : part
      const href = safeUrl(clean)
      return href ? (
        <span key={i}>
          <a href={href} target="_blank" rel="noopener noreferrer">
            {clean}
          </a>
          {trailing}
        </span>
      ) : (
        part
      )
    }

    return part
  })
}

interface RichTextProps {
  text: string
  sources?: Source[]
}

export default function RichText({ text, sources = [] }: RichTextProps) {
  const blocks = parseBlocks(text)
  return (
    <div className="rich">
      {blocks.map((block, i) => {
        if (block.kind === 'h') {
          return (
            <p key={i} className="rich__h">
              {renderInline(block.text, sources)}
            </p>
          )
        }
        if (block.kind === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul'
          return (
            <Tag key={i} className="rich__list">
              {block.items.map((item, j) => (
                <li key={j}>{renderInline(item, sources)}</li>
              ))}
            </Tag>
          )
        }
        return (
          <p key={i} className="rich__p">
            {block.lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {renderInline(l, sources)}
              </span>
            ))}
          </p>
        )
      })}
    </div>
  )
}