import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { highlight } from './highlight'
import './CodeBlock.css'

const LABELS: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  py: 'Python',
  python: 'Python',
  html: 'HTML',
  css: 'CSS',
  json: 'JSON',
  sh: 'Shell',
  bash: 'Bash',
  powershell: 'PowerShell',
  ps1: 'PowerShell',
  xml: 'XML',
  svg: 'SVG',
  sql: 'SQL',
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Older browsers: use a hidden text box instead.
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(area)
      return ok
    } catch {
      return false
    }
  }
}

interface CodeBlockProps {
  code: string
  lang: string
}

export default function CodeBlock({ code, lang }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  const label = LABELS[lang.toLowerCase()] ?? (lang ? lang.toUpperCase() : 'Code')
  const tokens = useMemo(() => highlight(code, lang), [code, lang])

  useEffect(() => {
    return () => window.clearTimeout(timer.current)
  }, [])

  async function copy() {
    const ok = await copyText(code)
    if (!ok) return
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="codeblock">
      <div className="codeblock__bar">
        <span className="codeblock__lang">{label}</span>
        <button
          type="button"
          className={copied ? 'codeblock__copy is-copied' : 'codeblock__copy'}
          onClick={copy}
          aria-label={`Copy ${label} code`}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
        <span className="codeblock__sr" role="status">
          {copied ? 'Code copied to clipboard' : ''}
        </span>
      </div>
      <pre className="codeblock__pre" tabIndex={0}>
        <code>
          {tokens.map((token, i) =>
            token.kind === 'plain' ? (
              token.text
            ) : (
              <span key={i} className={`tok tok--${token.kind}`}>
                {token.text}
              </span>
            ),
          )}
        </code>
      </pre>
    </div>
  )
}