import { useEffect, useRef, useState } from 'react'
import './Cosmic.css'

type Mode = 'study' | 'normal' | 'funny'
type RGB = [number, number, number]

interface Palette {
  core: RGB
  mid: RGB
  outer: RGB
  nebulaA: RGB
  nebulaB: RGB
}

// Each mode tints the same galaxy differently.
const PALETTES: Record<Mode, Palette> = {
  normal: {
    core: [255, 244, 224],
    mid: [140, 170, 255],
    outer: [150, 90, 255],
    nebulaA: [70, 90, 255],
    nebulaB: [160, 60, 220],
  },
  study: {
    core: [255, 236, 190],
    mid: [255, 190, 100],
    outer: [235, 110, 70],
    nebulaA: [230, 150, 60],
    nebulaB: [190, 70, 50],
  },
  funny: {
    core: [255, 240, 200],
    mid: [255, 120, 200],
    outer: [150, 90, 255],
    nebulaA: [255, 80, 170],
    nebulaB: [255, 200, 60],
  },
}

const ARMS = 4
const TWIST = 5.4 // how tightly the arms wind
const TILT = 0.46 // squashes the circle into a tilted disc
const SCREEN_ANGLE = -0.42
const COS_A = Math.cos(SCREEN_ANGLE)
const SIN_A = Math.sin(SCREEN_ANGLE)
const LUT_SIZE = 24
const STAR_COLORS = ['#ffffff', '#cfe0ff', '#ffe9c9']

interface Particle {
  radius: number
  angle: number
  size: number
  alpha: number
}

interface Star {
  x: number
  y: number
  size: number
  phase: number
  speed: number
  alpha: number
  color: string
}

interface Streak {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
}

const gauss = () => Math.random() + Math.random() + Math.random() - 1.5

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function rgba(c: RGB, a: number): string {
  return `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`
}

function clonePalette(p: Palette): Palette {
  return {
    core: [...p.core],
    mid: [...p.mid],
    outer: [...p.outer],
    nebulaA: [...p.nebulaA],
    nebulaB: [...p.nebulaB],
  }
}

// Moves the current colours a little towards the target colours.
function approach(current: Palette, target: Palette, k: number): void {
  current.core = mix(current.core, target.core, k)
  current.mid = mix(current.mid, target.mid, k)
  current.outer = mix(current.outer, target.outer, k)
  current.nebulaA = mix(current.nebulaA, target.nebulaA, k)
  current.nebulaB = mix(current.nebulaB, target.nebulaB, k)
}

function makeParticles(count: number): Particle[] {
  const list: Particle[] = []
  for (let i = 0; i < count; i++) {
    const t = Math.pow(Math.random(), 1.55) // more stars near the centre
    const arm = i % ARMS
    const spread = 0.16 + 0.5 * (1 - t)
    list.push({
      radius: Math.min(1, Math.max(0, t + gauss() * 0.02)),
      angle: (arm / ARMS) * Math.PI * 2 + t * TWIST + gauss() * spread,
      size: 0.7 + Math.random() * 1.5,
      alpha: (arm < 2 ? 0.75 : 0.45) * (0.35 + Math.random() * 0.65),
    })
  }
  return list
}

function makeStars(count: number): Star[] {
  const list: Star[] = []
  for (let i = 0; i < count; i++) {
    list.push({
      x: Math.random(),
      y: Math.random(),
      size: 0.5 + Math.random() * 1.2,
      phase: Math.random() * Math.PI * 2,
      speed: 0.6 + Math.random() * 1.8,
      alpha: 0.35 + Math.random() * 0.65,
      color: STAR_COLORS[i % STAR_COLORS.length] ?? '#ffffff',
    })
  }
  return list
}

export default function GalaxyBackground({ mode }: { mode: Mode }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const modeRef = useRef<Mode>(mode)
  const [reduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)

  // Remember the current mode so the animation can fade towards its colours.
  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  // With "reduce motion" the picture is still, so it is redrawn when the mode changes.
  const resetKey = reduced ? mode : 'live'

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const small = window.matchMedia('(max-width: 820px)').matches
    const finePointer = window.matchMedia('(pointer: fine)').matches
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)

    const particles = makeParticles(small ? 800 : 1700)
    const stars = makeStars(small ? 110 : 240)
    const streaks: Streak[] = []
    const palette = clonePalette(PALETTES[modeRef.current])

    let w = 1
    let h = 1
    let time = 0
    let rot = Math.random() * Math.PI * 2
    let streakTimer = 2 + Math.random() * 3
    let px = 0
    let py = 0
    let tx = 0
    let ty = 0

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      w = Math.max(1, rect.width)
      h = Math.max(1, rect.height)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    const glow = (x: number, y: number, r: number, c: RGB, a: number) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, rgba(c, a))
      g.addColorStop(1, rgba(c, 0))
      ctx.fillStyle = g
      ctx.fillRect(x - r, y - r, r * 2, r * 2)
    }

    const render = (dt: number) => {
      approach(palette, PALETTES[modeRef.current], dt === 0 ? 1 : Math.min(1, dt * 2.5))
      px += (tx - px) * Math.min(1, dt * 3)
      py += (ty - py) * Math.min(1, dt * 3)
      rot += dt * 0.018

      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'lighter'

      // Slow drifting nebula clouds
      const big = Math.max(w, h)
      glow(w * 0.22 + Math.sin(time * 0.05) * w * 0.06, h * 0.72 + Math.cos(time * 0.04) * h * 0.05, big * 0.5, palette.nebulaA, 0.16)
      glow(w * 0.82 + Math.cos(time * 0.045) * w * 0.05, h * 0.22 + Math.sin(time * 0.05) * h * 0.05, big * 0.45, palette.nebulaB, 0.14)

      // Twinkling background stars
      ctx.globalCompositeOperation = 'source-over'
      for (const s of stars) {
        const twinkle = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * s.speed + s.phase))
        ctx.globalAlpha = twinkle * s.alpha
        ctx.fillStyle = s.color
        ctx.beginPath()
        ctx.arc(s.x * w + px * 0.15, s.y * h + py * 0.15, s.size, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // The galaxy itself
      const cx = w * 0.58 + px
      const cy = h * 0.46 + py
      const R = big * 0.62
      ctx.globalCompositeOperation = 'lighter'

      ctx.save()
      ctx.translate(cx, cy)
      ctx.rotate(SCREEN_ANGLE)
      ctx.scale(1, TILT + 0.25)
      glow(0, 0, R, palette.outer, 0.13)
      glow(0, 0, R * 0.42, palette.core, 0.5)
      ctx.restore()

      const lut: string[] = []
      for (let i = 0; i < LUT_SIZE; i++) {
        const t = i / (LUT_SIZE - 1)
        const c = t < 0.25 ? mix(palette.core, palette.mid, t / 0.25) : mix(palette.mid, palette.outer, (t - 0.25) / 0.75)
        lut.push(`rgb(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])})`)
      }

      for (const p of particles) {
        const a = p.angle + rot
        const rr = p.radius * R
        const gx = Math.cos(a) * rr
        const gy = Math.sin(a) * rr * TILT
        const x = cx + gx * COS_A - gy * SIN_A + px * p.radius
        const y = cy + gx * SIN_A + gy * COS_A + py * p.radius
        ctx.globalAlpha = p.alpha * (1 - p.radius * 0.35)
        ctx.fillStyle = lut[Math.min(LUT_SIZE - 1, Math.floor(p.radius * LUT_SIZE))] ?? '#ffffff'
        ctx.fillRect(x, y, p.size, p.size)
      }
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'

      // Shooting stars
      streakTimer -= dt
      if (streakTimer <= 0 && streaks.length < 2) {
        streaks.push({
          x: Math.random() * w * 0.7,
          y: Math.random() * h * 0.35,
          vx: 500 + Math.random() * 400,
          vy: 180 + Math.random() * 220,
          age: 0,
          life: 0.9 + Math.random() * 0.6,
        })
        streakTimer = 4 + Math.random() * 7
      }
      for (const s of streaks) {
        s.x += s.vx * dt
        s.y += s.vy * dt
        s.age += dt
        const fade = Math.sin(Math.PI * Math.min(1, s.age / s.life))
        const tailX = s.x - s.vx * 0.14
        const tailY = s.y - s.vy * 0.14
        const g = ctx.createLinearGradient(tailX, tailY, s.x, s.y)
        g.addColorStop(0, 'rgba(255,255,255,0)')
        g.addColorStop(1, `rgba(255,255,255,${0.9 * fade})`)
        ctx.strokeStyle = g
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(tailX, tailY)
        ctx.lineTo(s.x, s.y)
        ctx.stroke()
      }
      for (let i = streaks.length - 1; i >= 0; i--) {
        const s = streaks[i]
        if (s && s.age >= s.life) streaks.splice(i, 1)
      }
    }

    resize()
    const observer = new ResizeObserver(() => {
      resize()
      if (reduced) render(0)
    })
    observer.observe(canvas)

    let raf = 0
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / w - 0.5) * 36
      ty = (e.clientY / h - 0.5) * 24
    }

    if (reduced) {
      render(0) // one still picture
    } else {
      let last = performance.now()
      const frame = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        time += dt
        render(dt)
        raf = requestAnimationFrame(frame)
      }
      raf = requestAnimationFrame(frame)
      if (finePointer) window.addEventListener('pointermove', onMove, { passive: true })
    }

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      window.removeEventListener('pointermove', onMove)
    }
  }, [reduced, resetKey])

  return <canvas ref={canvasRef} className="galaxy" aria-hidden="true" />
}