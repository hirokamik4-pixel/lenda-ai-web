import { useEffect, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { fetchImage } from './api'
import './ImageCard.css'

type State =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string }

interface ImageCardProps {
  prompt: string
  seed: number
}

export default function ImageCard({ prompt, seed }: ImageCardProps) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [variant, setVariant] = useState(0) // changes the seed for a new version

  useEffect(() => {
    const controller = new AbortController()
    let objectUrl = ''

    fetchImage(prompt, seed + variant, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setState({ status: 'ready', url: objectUrl })
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          message: error instanceof Error ? error.message : 'Could not make the image.',
        })
      })

    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [prompt, seed, variant])

  function another() {
    setState({ status: 'loading' })
    setVariant((v) => v + 1)
  }

  return (
    <div className="imagecard">
      {state.status === 'loading' && (
        <div className="imagecard__frame imagecard__loading" role="status">
          <span className="imagecard__emoji" aria-hidden="true">
            🎨
          </span>
          <p>Painting your image…</p>
          <p className="imagecard__hint">This can take 10 to 30 seconds.</p>
        </div>
      )}

      {state.status === 'error' && (
        <div className="imagecard__frame imagecard__error" role="alert">
          <p>⚠️ {state.message}</p>
          <button type="button" className="imagecard__btn" onClick={another}>
            <RefreshCw size={14} /> Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && (
        <>
          <img className="imagecard__img" src={state.url} alt={prompt} />
          <div className="imagecard__actions">
            <a className="imagecard__btn" href={state.url} download="lenda-ai-image.jpg">
              <Download size={14} /> Download
            </a>
            <button type="button" className="imagecard__btn" onClick={another}>
              <RefreshCw size={14} /> New version
            </button>
          </div>
        </>
      )}
    </div>
  )
}