// Client-side engines for Aura Studio: image processing, generative music
// and the reel recorder. Everything here runs in the visitor's browser;
// only "AI Enhance / Reimagine" calls the Axion server (see studioApi.ts).

export interface ImageHandle {
  url: string
  blob: Blob
  name: string
}

export function readImageFile(file: File): Promise<ImageHandle> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => resolve({ url, blob: file, name: file.name || 'image' })
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as an image.'))
    }
    img.src = url
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load the image.'))
    img.src = src
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create the image.'))), type, quality)
  })
}

export const FILTER_PRESETS: { id: string; label: string; css: string }[] = [
  { id: 'none', label: 'None', css: 'none' },
  { id: 'vivid', label: 'Vivid', css: 'saturate(1.35) contrast(1.08) brightness(1.02)' },
  { id: 'aurora', label: 'Aurora', css: 'saturate(1.25) hue-rotate(-12deg) brightness(1.05)' },
  { id: 'noir', label: 'Noir', css: 'grayscale(1) contrast(1.12)' },
  { id: 'warm', label: 'Warm', css: 'sepia(0.28) saturate(1.15) brightness(1.04)' },
  { id: 'cool', label: 'Cool', css: 'hue-rotate(14deg) saturate(1.08)' },
  { id: 'soft', label: 'Soft glow', css: 'brightness(1.06) contrast(0.94) saturate(1.1) blur(0.4px)' },
]

/* Re-renders the image with a CSS filter preset applied. */
export async function applyPreset(src: string, presetId: string): Promise<Blob> {
  const img = await loadImage(src)
  const preset = FILTER_PRESETS.find((p) => p.id === presetId)
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  if (preset && preset.css !== 'none') ctx.filter = preset.css
  ctx.drawImage(img, 0, 0)
  return canvasToBlob(canvas, 'image/png')
}

/* Quick Boost: mild upscale with smoothing plus a clarity/color lift.
   Runs fully locally — honest "no external AI" boost. */
export async function boostImage(src: string): Promise<Blob> {
  const img = await loadImage(src)
  const targetW = Math.min(img.naturalWidth * 2, 4096)
  const targetH = Math.min(img.naturalHeight * 2, 4096)
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.filter = 'contrast(1.09) saturate(1.16) brightness(1.03)'
  ctx.drawImage(img, 0, 0, targetW, targetH)
  return canvasToBlob(canvas, 'image/png')
}

/* Removes the background with a neural model that runs in the browser.
   The first use downloads the model (~40 MB) and then it is cached. */
export async function removeBackgroundBlob(
  blob: Blob,
  onProgress: (ratio: number) => void,
): Promise<Blob> {
  const { removeBackground } = await import('@imgly/background-removal')
  return removeBackground(blob, {
    progress: (_key, current, total) => {
      if (total > 0) onProgress(Math.min(0.99, current / total))
    },
  })
}

/* A small JPEG data URL (max 512px) for the server-side AI edit calls. */
export async function makeServerImage(src: string): Promise<string> {
  const img = await loadImage(src)
  const scale = Math.min(1, 512 / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.85)
}

/* AI Enhance: real neural 2x upscaling that runs in the browser, so the
   result stays faithful to the photo. No server and no external keys. */
export async function aiEnhance(src: string): Promise<Blob> {
  const img = await loadImage(src)
  const scale = Math.min(1, 768 / Math.max(img.naturalWidth, img.naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

  const [{ default: Upscaler }, tf, wasm] = await Promise.all([
    import('upscaler'),
    import('@tensorflow/tfjs'),
    import('@tensorflow/tfjs-backend-wasm'),
  ])
  wasm.setWasmPaths('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs-backend-wasm@4.11.0/dist/')
  // The wasm backend is deterministic and works even where WebGL is unavailable.
  const ok = await tf.setBackend('wasm')
  if (!ok) throw new Error('The AI engine could not start in this browser.')
  await tf.ready()
  const upscaler = new Upscaler()
  const result = await upscaler.upscale(canvas)
  const url = result.startsWith('data:') ? result : `data:image/png;base64,${result}`
  return (await fetch(url)).blob()
}

/* ------------------------------------------------------------------ */
/* Generative music                                                     */
/* ------------------------------------------------------------------ */

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hashSeed(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

const CHORD_SETS: number[][][] = [
  [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]], // Am F C G
  [[50, 53, 57], [46, 50, 53], [53, 57, 60], [48, 52, 55]], // Dm Bb F C
  [[52, 55, 59], [48, 52, 55], [55, 59, 62], [50, 53, 57]], // Em C G D
]

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

function writeNote(
  data: Float32Array<ArrayBuffer>,
  startSec: number,
  durSec: number,
  freq: number,
  gain: number,
  sampleRate: number,
  wave: OscillatorType,
  rand: () => number,
) {
  const start = Math.floor(startSec * sampleRate)
  const length = Math.min(data.length - start, Math.floor(durSec * sampleRate))
  if (length <= 0) return
  const attack = Math.min(0.25, durSec * 0.3)
  const release = Math.min(0.6, durSec * 0.4)
  for (let i = 0; i < length; i++) {
    const t = i / sampleRate
    const pos = i / length
    let env = 1
    if (t < attack) env = t / attack
    else if (pos > 1 - release / durSec) env = Math.max(0, (1 - pos) * (durSec / release))
    const wobble = 1 + (rand() - 0.5) * 0.004
    const phase = 2 * Math.PI * freq * wobble * t
    let sample: number
    if (wave === 'sine') sample = Math.sin(phase)
    else if (wave === 'triangle') sample = (2 / Math.PI) * Math.asin(Math.sin(phase))
    else sample = (Math.sin(phase) + 0.4 * Math.sin(2 * phase)) * 0.7
    data[start + i] += sample * gain * env
  }
}

/* Composes a soft ambient loop from a seed. Deterministic: the same
   prompt always makes the same music. Returns mono sample data. */
export function composeData(seed: number, seconds: number, sampleRate = 44100): Float32Array<ArrayBuffer> {
  const rand = mulberry32(seed)
  const length = Math.floor(seconds * sampleRate)
  const data = new Float32Array(length)
  const chords = CHORD_SETS[seed % CHORD_SETS.length]
  const barSec = 3.2
  const bars = Math.max(2, Math.floor(seconds / barSec))
  const bassGain = 0.16
  const padGain = 0.11
  const arpGain = 0.07

  for (let bar = 0; bar < bars; bar++) {
    const chord = chords[bar % chords.length]
    const t0 = bar * barSec

    // Bass: root note one octave down.
    writeNote(data, t0, barSec * 0.95, midiToFreq(chord[0] - 12), bassGain, sampleRate, 'sine', rand)

    // Pad: the chord, softly detuned.
    for (const midi of chord) {
      writeNote(data, t0, barSec, midiToFreq(midi), padGain, sampleRate, 'triangle', rand)
      writeNote(data, t0, barSec, midiToFreq(midi + 12), padGain * 0.4, sampleRate, 'sine', rand)
    }

    // Arpeggio: eighth notes over the chord, two octaves up.
    const arp = [...chord, chord[0] + 12, chord[1] + 12]
    for (let step = 0; step < 8; step++) {
      const midi = arp[step % arp.length] + 12
      const t = t0 + (step * barSec) / 8
      const dur = barSec / 8 * 1.6
      const accent = step % 4 === 0 ? 1.25 : 0.8
      writeNote(data, t, dur, midiToFreq(midi), arpGain * accent, sampleRate, 'triangle', rand)
    }
  }

  // Gentle fade in/out.
  const fade = Math.floor(sampleRate * 1.2)
  for (let i = 0; i < fade && i < data.length; i++) {
    data[i] *= i / fade
    data[data.length - 1 - i] *= i / fade
  }

  // Soft clip so mixed layers never crackle.
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.tanh(data[i] * 1.15) * 0.85
  }

  return data
}

export function makeMusicBuffer(context: AudioContext, seed: number, seconds: number): AudioBuffer {
  const data = composeData(seed, seconds, context.sampleRate)
  const buffer = context.createBuffer(2, data.length, context.sampleRate)
  buffer.copyToChannel(data, 0)
  buffer.copyToChannel(data, 1)
  return buffer
}

export function downloadWav(buffer: AudioBuffer, filename: string) {
  const channels = Math.min(2, buffer.numberOfChannels)
  const frames = buffer.length
  const bytesPerSample = 2
  const blockAlign = channels * bytesPerSample
  const dataSize = frames * blockAlign
  const arrayBuffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(arrayBuffer)

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, buffer.sampleRate, true)
  view.setUint32(28, buffer.sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  const channelData: Float32Array[] = []
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c))
  let offset = 44
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c][i]))
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  const blob = new Blob([arrayBuffer], { type: 'audio/wav' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ------------------------------------------------------------------ */
/* Reel recorder                                                        */
/* ------------------------------------------------------------------ */

export interface ReelResult {
  url: string
  blob: Blob
}

/* Records a short Ken Burns reel (video + music) from an image.
   Canvas frames and generated audio are captured in the browser. */
export async function recordReel(
  imageSrc: string,
  musicSeed: number,
  seconds: number,
  onProgress: (ratio: number) => void,
): Promise<ReelResult> {
  const img = await loadImage(imageSrc)
  const W = 720
  const H = 1280
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  document.body.appendChild(canvas)
  canvas.style.cssText = 'position:fixed;left:-9999px;top:0;pointer-events:none;'

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser.')

  // Cover-fit source rectangle (the crop moves for the Ken Burns effect).
  const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight)
  const srcW = W / scale
  const srcH = H / scale
  const startX = (img.naturalWidth - srcW) / 2
  const startY = (img.naturalHeight - srcH) / 2

  const audioContext = new AudioContext()
  await audioContext.resume()
  const music = makeMusicBuffer(audioContext, musicSeed, seconds + 1)
  const musicSource = audioContext.createBufferSource()
  musicSource.buffer = music
  const musicGain = audioContext.createGain()
  musicGain.gain.value = 0.4
  const destination = audioContext.createMediaStreamDestination()
  musicSource.connect(musicGain)
  musicGain.connect(destination)
  musicGain.connect(audioContext.destination)

  const videoStream = canvas.captureStream(30)
  const mixedStream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...destination.stream.getAudioTracks(),
  ])

  const preferred = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
  const mimeType = preferred.find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
  const recorder = mimeType ? new MediaRecorder(mixedStream, { mimeType, videoBitsPerSecond: 6_000_000 }) : new MediaRecorder(mixedStream)
  const chunks: Blob[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  const startTime = performance.now()
  musicSource.start()
  recorder.start(200)

  await new Promise<void>((resolve, reject) => {
    let stopped = false

    const draw = () => {
      if (stopped) return
      const elapsed = performance.now() - startTime
      const progress = Math.min(1, elapsed / (seconds * 1000))
      // Slow zoom in + gentle pan across the photo.
      const zoom = 1 + progress * 0.18
      const pan = progress * srcW * 0.12
      const cropW = srcW / zoom
      const cropH = srcH / zoom
      const sx = startX + pan
      const sy = startY + (srcH - cropH) / 2
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, W, H)
      ctx.drawImage(img, sx, sy, cropW, cropH, 0, 0, W, H)
      onProgress(progress)
      if (progress >= 1) {
        stopped = true
        resolve()
        return
      }
      requestAnimationFrame(draw)
    }

    recorder.onstop = () => resolve()
    recorder.onerror = () => {
      stopped = true
      reject(new Error('The reel recording failed in this browser.'))
    }

    const finish = () => {
      stopped = true
      if (recorder.state !== 'inactive') recorder.stop()
      else resolve()
    }
    window.setTimeout(finish, seconds * 1000 + 250)
    requestAnimationFrame(draw)
  })

  musicSource.stop()
  void audioContext.close()
  canvas.remove()

  const blob = new Blob(chunks, { type: mimeType || 'video/webm' })
  if (blob.size === 0) throw new Error('The recording came out empty. Please try again.')
  return { url: URL.createObjectURL(blob), blob }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
