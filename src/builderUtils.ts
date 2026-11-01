/* Pure helper functions for the website builder. */

// Removes markdown fences and any text before <!DOCTYPE or <html.
export function extractHtml(raw: string): string {
  let text = raw.replace(/\r\n/g, '\n').trim()
  const fence = text.match(/^```[\w-]*\n([\s\S]*?)(?:\n```\s*)?$/)
  if (fence?.[1]) text = fence[1].trim()
  const start = text.search(/<!doctype html|<html[\s>]/i)
  if (start > 0) text = text.slice(start)
  return text
}

// The AI replies "REFUSED: reason" for requests it will not build.
export function isRefusal(raw: string): string | null {
  const match = raw.trim().match(/^REFUSED:\s*(.{0,200})/i)
  if (!match) return null
  return (match[1] ?? '').trim() || 'This request is not allowed.'
}

export function isComplete(html: string): boolean {
  return /<\/html>\s*$/i.test(html.trim())
}

// Light automatic fixes: a viewport tag (so the phone preview works) and closing tags.
export function repairHtml(html: string): string {
  let out = html.trim()
  if (/<head[^>]*>/i.test(out) && !/<meta[^>]+name=["']viewport["']/i.test(out)) {
    out = out.replace(
      /<head[^>]*>/i,
      (m) => `${m}\n<meta name="viewport" content="width=device-width, initial-scale=1">`,
    )
  }
  if (!/<\/body>/i.test(out)) out += '\n</body>'
  if (!/<\/html>/i.test(out)) out += '\n</html>'
  return out
}

/* ---- Applying edit blocks ---- */

export interface PatchResult {
  html: string
  applied: number
  failed: number
}

// Finds the search lines even when the AI got the indentation slightly different.
function fuzzyReplace(html: string, search: string, replacement: string): string | null {
  const want = search
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (want.length === 0) return null

  const lines = html.split('\n')
  const nonEmpty: { idx: number; text: string }[] = []
  lines.forEach((line, idx) => {
    const text = line.trim()
    if (text) nonEmpty.push({ idx, text })
  })

  for (let i = 0; i + want.length <= nonEmpty.length; i++) {
    let match = true
    for (let j = 0; j < want.length; j++) {
      if (nonEmpty[i + j]?.text !== want[j]) {
        match = false
        break
      }
    }
    if (match) {
      const first = nonEmpty[i]?.idx
      const last = nonEmpty[i + want.length - 1]?.idx
      if (first === undefined || last === undefined) return null
      return [...lines.slice(0, first), replacement, ...lines.slice(last + 1)].join('\n')
    }
  }
  return null
}

export function applyPatches(source: string, reply: string): PatchResult {
  const pattern = /<{5,9} SEARCH\r?\n([\s\S]*?)\r?\n={5,9}\r?\n([\s\S]*?)\r?\n?>{5,9} REPLACE/g
  let html = source
  let applied = 0
  let failed = 0

  for (const match of reply.matchAll(pattern)) {
    const search = match[1] ?? ''
    const replacement = match[2] ?? ''
    if (!search.trim()) {
      failed++
      continue
    }
    const at = html.indexOf(search)
    if (at !== -1) {
      html = html.slice(0, at) + replacement + html.slice(at + search.length)
      applied++
      continue
    }
    const fuzzy = fuzzyReplace(html, search, replacement)
    if (fuzzy !== null) {
      html = fuzzy
      applied++
    } else {
      failed++
    }
  }
  return { html, applied, failed }
}

// Joins the second half of a cut-off file, removing any repeated overlap.
export function joinContinuation(existing: string, more: string): string {
  const cleaned = more
    .replace(/^\s*```[\w-]*\n/, '')
    .replace(/\n```\s*$/, '')
    .replace(/^\r?\n/, '')
  const max = Math.min(300, existing.length, cleaned.length)
  for (let n = max; n >= 20; n--) {
    if (existing.endsWith(cleaned.slice(0, n))) return existing + cleaned.slice(n)
  }
  return existing + cleaned
}

/* ---- Preview ---- */

// Added only to the preview (never to your downloaded file). It reports
// JavaScript errors from the page so the builder can offer a one-click fix.
const PREVIEW_GUARD =
  "<script>(function(){function s(m){try{parent.postMessage({source:'axion-preview',message:String(m).slice(0,300)},'*')}catch(e){}}" +
  "window.addEventListener('error',function(e){s((e.message||'Script error')+(e.lineno?' (line '+e.lineno+')':''))});" +
  "window.addEventListener('unhandledrejection',function(e){s('Unhandled promise rejection: '+((e.reason&&e.reason.message)||e.reason))});" +
  "var ce=console.error;console.error=function(){s(Array.prototype.join.call(arguments,' '));ce.apply(console,arguments)}})();</script>"

export function previewDoc(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + PREVIEW_GUARD)
  return PREVIEW_GUARD + html
}

/* ---- Files ---- */

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'website'
  )
}

export function downloadHtml(html: string, name: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = `${slugify(name)}.html`
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}