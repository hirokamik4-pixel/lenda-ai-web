// Server calls for Aura Studio. Only AI Enhance / Reimagine need the
// Axion server; every other feature runs locally in the browser.
const configured = import.meta.env.VITE_API_URL as string | undefined
const API_URL = (configured || 'http://localhost:8787').replace(/\/+$/, '')

export const STUDIO_SERVER_DOWN =
  'Cannot reach the Axion server. It may be waking up (this can take up to a minute), so please try again shortly.'

export async function fetchImageEdit(
  imageDataUrl: string,
  prompt: string,
  strength: number,
  timeoutMs = 150_000,
): Promise<Blob> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    let response: Response
    try {
      response = await fetch(`${API_URL}/api/image/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: imageDataUrl, prompt, strength }),
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) throw error
      throw new Error(STUDIO_SERVER_DOWN, { cause: error })
    }
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.error ?? `The edit failed (${response.status}).`)
    }
    return response.blob()
  } finally {
    window.clearTimeout(timer)
  }
}
