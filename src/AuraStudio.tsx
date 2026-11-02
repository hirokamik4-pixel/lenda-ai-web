import { useEffect, useRef, useState } from 'react'
import {
  Clapperboard,
  Download,
  Eraser,
  ImageDown,
  LoaderCircle,
  Music2,
  Play,
  RotateCcw,
  Sparkles,
  Square,
  Upload,
  Wand2,
} from 'lucide-react'
import GalaxyBackground from './GalaxyBackground'
import {
  applyPreset,
  boostImage,
  downloadBlob,
  downloadWav,
  FILTER_PRESETS,
  hashSeed,
  aiEnhance,
  makeMusicBuffer,
  makeServerImage,
  readImageFile,
  recordReel,
  removeBackgroundBlob,
  type ImageHandle,
} from './auraStudioEngine'
import { fetchImageEdit } from './studioApi'
import './AuraStudio.css'

type StudioTab = 'edit' | 'reel' | 'music'
type BusyKind = '' | 'bg' | 'boost' | 'enhance' | 'reimagine' | 'reel'

const REIMAGINE_DEFAULT = 'Reimagine this image in a dreamy cosmic style with glowing aura colors.'

const REEL_SECONDS = 6

export default function AuraStudio({ active }: { active: boolean }) {
  const [tab, setTab] = useState<StudioTab>('edit')
  const [image, setImage] = useState<ImageHandle | null>(null)
  const [original, setOriginal] = useState<ImageHandle | null>(null)
  const [busy, setBusy] = useState<BusyKind>('')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [preset, setPreset] = useState('none')
  const [reimaginePrompt, setReimaginePrompt] = useState(REIMAGINE_DEFAULT)

  const [reelMusic, setReelMusic] = useState('soft dreamy aura')
  const [reelUrl, setReelUrl] = useState('')
  const [reelBlob, setReelBlob] = useState<Blob | null>(null)

  const [musicPrompt, setMusicPrompt] = useState('floating through a calm galaxy')
  const [playing, setPlaying] = useState(false)

  const fileInput = useRef<HTMLInputElement>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const musicSource = useRef<AudioBufferSourceNode | null>(null)
  const analyser = useRef<AnalyserNode | null>(null)
  const barRefs = useRef<(HTMLSpanElement | null)[]>([])

  const presetCss = FILTER_PRESETS.find((p) => p.id === preset)?.css ?? 'none'

  function acceptFiles(fileList: FileList | null) {
    const file = fileList?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    setError('')
    setStatus('')
    setReelUrl('')
    setReelBlob(null)
    void readImageFile(file).then((handle) => {
      setImage(handle)
      setOriginal(handle)
    }).catch(() => setError('That file could not be read as an image.'))
  }

  function replaceImage(blob: Blob) {
    const handle: ImageHandle = {
      url: URL.createObjectURL(blob),
      blob,
      name: image?.name ?? 'image',
    }
    setImage(handle)
    return handle
  }

  async function runEdit(kind: Exclude<BusyKind, '' | 'reel'>) {
    if (!image || busy) return
    setBusy(kind)
    setError('')
    setStatus('')
    setProgress(0)
    try {
      if (kind === 'bg') {
        setStatus('Downloading the AI model on first use, then erasing the background…')
        const blob = await removeBackgroundBlob(image.blob, setProgress)
        replaceImage(blob)
        setStatus('Background removed. The cutout has a transparent backdrop.')
      } else if (kind === 'boost') {
        setStatus('Boosting clarity and color…')
        const blob = await boostImage(image.url)
        replaceImage(blob)
        setStatus('Boosted — sharper and more vivid, doubled in size.')
      } else if (kind === 'enhance') {
        setStatus('The AI is enhancing your photo — the neural model loads on first use…')
        const blob = await aiEnhance(image.url)
        replaceImage(blob)
        setStatus('AI enhancement finished — neural 2× upscale, faithful to your photo.')
      } else {
        const dataUrl = await makeServerImage(image.url)
        setStatus('The Axion AI is reimagining your photo…')
        const blob = await fetchImageEdit(dataUrl, reimaginePrompt.trim() || REIMAGINE_DEFAULT, 0.6)
        replaceImage(blob)
        setStatus('AI reimagining finished.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.')
    } finally {
      setBusy('')
      setProgress(0)
    }
  }

  async function downloadCurrent() {
    if (!image || busy) return
    setBusy('boost')
    setError('')
    try {
      const blob = preset === 'none' ? image.blob : await applyPreset(image.url, preset)
      downloadBlob(blob, 'aura-edit.png')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not prepare the download.')
    } finally {
      setBusy('')
    }
  }

  async function startReel() {
    if (!image || busy) return
    setBusy('reel')
    setError('')
    setStatus('')
    setReelUrl('')
    setReelBlob(null)
    setProgress(0)
    try {
      const result = await recordReel(image.url, hashSeed(reelMusic), REEL_SECONDS, setProgress)
      setReelBlob(result.blob)
      setReelUrl(result.url)
      setStatus('Your reel is ready.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The reel recording failed. Please try again.')
    } finally {
      setBusy('')
      setProgress(0)
    }
  }

  function ensureAudio(): AudioContext {
    if (!audioContext.current) {
      const ctx = new AudioContext()
      const node = ctx.createAnalyser()
      node.fftSize = 64
      node.smoothingTimeConstant = 0.8
      node.connect(ctx.destination)
      analyser.current = node
      audioContext.current = ctx
    }
    return audioContext.current
  }

  function toggleMusic() {
    const ctx = ensureAudio()
    if (playing) {
      musicSource.current?.stop()
      musicSource.current = null
      setPlaying(false)
      return
    }
    void ctx.resume().then(() => {
      const source = ctx.createBufferSource()
      source.buffer = makeMusicBuffer(ctx, hashSeed(musicPrompt), 12.8)
      source.loop = true
      source.connect(analyser.current ?? ctx.destination)
      source.start()
      musicSource.current = source
      setPlaying(true)
    })
  }

  function downloadMusic() {
    const ctx = ensureAudio()
    const buffer = makeMusicBuffer(ctx, hashSeed(musicPrompt), 30)
    downloadWav(buffer, 'aura-music.wav')
  }

  // Real-time visualizer while music plays; gentle idle wave otherwise.
  useEffect(() => {
    let frame = 0
    let t = 0
    const freqData = new Uint8Array(analyser.current?.frequencyBinCount ?? 64)
    const draw = () => {
      t += 0.05
      let data: Uint8Array | null = null
      if (analyser.current) {
        analyser.current.getByteFrequencyData(freqData)
        data = freqData
      }
      barRefs.current.forEach((bar, i) => {
        if (!bar) return
        const live = data ? data[Math.floor((i / barRefs.current.length) * data.length)] / 255 : 0
        const idle = 0.18 + 0.14 * Math.sin(t * 2 + i * 0.7)
        const height = playing ? Math.max(0.08, live) : idle
        bar.style.transform = `scaleY(${height})`
      })
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [playing])

  // Stop the music when the studio is closed.
  useEffect(() => {
    return () => {
      musicSource.current?.stop()
      void audioContext.current?.close()
      audioContext.current = null
      musicSource.current = null
    }
  }, [])

  return (
    <div className="aura-studio">
      {active && <GalaxyBackground mode="normal" />}
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => acceptFiles(event.target.files)}
      />
      <div className="aura-studio__inner">
        <header className="aura-studio__head">
          <div>
            <h2 className="aura-studio__title">✨ Aura Studio</h2>
            <p className="aura-studio__lead">
              Edit images with AI, turn them into reels with music, or compose a vibe from your words.
            </p>
          </div>
          <div className="aura-studio__tabs" role="tablist" aria-label="Aura Studio sections">
            {(
              [
                ['edit', 'Edit', Wand2],
                ['reel', 'Reel', Clapperboard],
                ['music', 'Music', Music2],
              ] as const
            ).map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? 'is-on' : ''}
                onClick={() => setTab(id)}
              >
                <Icon size={15} aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </header>

        {/* ---------------- EDIT ---------------- */}
        {tab === 'edit' && (
          <div className="aura-studio__body">
            <div className="aura-panel aura-panel--preview">
              {image ? (
                <>
                  <img
                    className="aura-preview"
                    src={image.url}
                    alt="Your working image"
                    style={{ filter: presetCss }}
                  />
                  {busy === 'bg' && (
                    <div className="aura-preview__busy">
                      <LoaderCircle className="spin" size={22} aria-hidden="true" />
                      <span>{Math.round(progress * 100)}%</span>
                    </div>
                  )}
                  <button
                    type="button"
                    className="aura-preview__revert"
                    title="Back to the original"
                    onClick={() => setImage(original)}
                    disabled={!original || image.url === original?.url}
                  >
                    <RotateCcw size={15} aria-hidden="true" />
                    Original
                  </button>
                </>
              ) : (
                <button type="button" className="aura-dropzone" onClick={() => fileInput.current?.click()}>
                  <Upload size={26} aria-hidden="true" />
                  <strong>Drop an image here</strong>
                  <span>or click to choose one from your device</span>
                </button>
              )}
            </div>

            <div className="aura-panel aura-panel--tools">
              <h3>AI edits</h3>
              <div className="aura-actions">
                <button type="button" className="aura-btn" disabled={!image || busy !== ''} onClick={() => void runEdit('bg')}>
                  <Eraser size={16} aria-hidden="true" />
                  Remove background
                  <small>AI in your browser</small>
                </button>
                <button type="button" className="aura-btn" disabled={!image || busy !== ''} onClick={() => void runEdit('boost')}>
                  <Sparkles size={16} aria-hidden="true" />
                  Quick boost
                  <small>Sharpen · vivid · 2× size</small>
                </button>
                <button type="button" className="aura-btn" disabled={!image || busy !== ''} onClick={() => void runEdit('enhance')}>
                  <Wand2 size={16} aria-hidden="true" />
                  AI enhance
                  <small>Neural 2× upscale in your browser</small>
                </button>
              </div>

              <div className="aura-reimagine">
                <textarea
                  value={reimaginePrompt}
                  onChange={(event) => setReimaginePrompt(event.target.value)}
                  rows={2}
                  placeholder="Describe how the AI should reimagine your image…"
                />
                <button type="button" className="aura-btn" disabled={!image || busy !== ''} onClick={() => void runEdit('reimagine')}>
                  <Wand2 size={16} aria-hidden="true" />
                  AI reimagine
                  <small>Axion server AI</small>
                </button>
              </div>

              <h3>Filters</h3>
              <div className="aura-filters">
                {FILTER_PRESETS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    className={preset === filter.id ? 'is-on' : ''}
                    onClick={() => setPreset(filter.id)}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>

              <button type="button" className="aura-btn aura-btn--primary" disabled={!image || busy !== ''} onClick={() => void downloadCurrent()}>
                {busy === 'boost' ? <LoaderCircle className="spin" size={16} aria-hidden="true" /> : <ImageDown size={16} aria-hidden="true" />}
                Download
              </button>

              {status && <p className="aura-status">{status}</p>}
              {error && <p className="aura-error">{error}</p>}
            </div>
          </div>
        )}

        {/* ---------------- REEL ---------------- */}
        {tab === 'reel' && (
          <div className="aura-studio__body">
            <div className="aura-panel aura-panel--preview">
              {image ? (
                <>
                  {reelUrl ? (
                    <video className="aura-preview" src={reelUrl} controls loop playsInline />
                  ) : (
                    <img className="aura-preview" src={image.url} alt="The photo for your reel" />
                  )}
                  {busy === 'reel' && (
                    <div className="aura-preview__busy">
                      <LoaderCircle className="spin" size={22} aria-hidden="true" />
                      <span>Recording {Math.round(progress * 100)}%</span>
                    </div>
                  )}
                </>
              ) : (
                <button type="button" className="aura-dropzone" onClick={() => fileInput.current?.click()}>
                  <Upload size={26} aria-hidden="true" />
                  <strong>Choose a photo first</strong>
                  <span>It becomes a cinematic reel with music</span>
                </button>
              )}
            </div>

            <div className="aura-panel aura-panel--tools">
              <h3>Photo reel</h3>
              <p className="aura-hint">
                A {REEL_SECONDS}-second cinematic clip: slow zoom across your photo with generated
                background music, recorded entirely in your browser.
              </p>
              <label className="aura-field">
                <span>Music vibe</span>
                <input
                  type="text"
                  value={reelMusic}
                  onChange={(event) => setReelMusic(event.target.value)}
                  placeholder="soft dreamy aura"
                />
              </label>
              <button type="button" className="aura-btn aura-btn--primary" disabled={!image || busy !== ''} onClick={() => void startReel()}>
                <Clapperboard size={16} aria-hidden="true" />
                {busy === 'reel' ? 'Recording…' : 'Make my reel'}
              </button>
              {reelBlob && (
                <button type="button" className="aura-btn" onClick={() => downloadBlob(reelBlob, 'aura-reel.webm')}>
                  <Download size={16} aria-hidden="true" />
                  Download reel
                </button>
              )}
              <button type="button" className="aura-linkbtn" onClick={() => fileInput.current?.click()}>
                Use a different photo
              </button>
              {status && <p className="aura-status">{status}</p>}
              {error && <p className="aura-error">{error}</p>}
            </div>
          </div>
        )}

        {/* ---------------- MUSIC ---------------- */}
        {tab === 'music' && (
          <div className="aura-studio__body">
            <div className="aura-panel aura-panel--preview aura-panel--music">
              <div className="aura-viz" aria-hidden="true">
                {Array.from({ length: 28 }).map((_, i) => (
                  <span
                    key={i}
                    ref={(el) => {
                      barRefs.current[i] = el
                    }}
                  />
                ))}
              </div>
              <p className="aura-viz__label">{playing ? 'Now playing' : 'Your vibe, visualised'}</p>
            </div>

            <div className="aura-panel aura-panel--tools">
              <h3>Music maker</h3>
              <p className="aura-hint">
                Describe a vibe and the browser composes a unique ambient loop for it — same words,
                same song, every time. No external AI needed.
              </p>
              <label className="aura-field">
                <span>Describe your vibe</span>
                <input
                  type="text"
                  value={musicPrompt}
                  onChange={(event) => setMusicPrompt(event.target.value)}
                  placeholder="floating through a calm galaxy"
                />
              </label>
              <div className="aura-actions">
                <button type="button" className="aura-btn aura-btn--primary" onClick={toggleMusic}>
                  {playing ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                  {playing ? 'Stop' : 'Play'}
                </button>
                <button type="button" className="aura-btn" onClick={downloadMusic}>
                  <Download size={16} aria-hidden="true" />
                  Download WAV
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
