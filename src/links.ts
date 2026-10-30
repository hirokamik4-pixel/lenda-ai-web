/* Only plain web links (http/https) are allowed. This blocks things like
   "javascript:" links that could be dangerous. */
export function safeUrl(raw: string): string | null {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}