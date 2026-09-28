import { useEffect, useState } from 'react'
import {
  AbsoluteFill, Img, OffthreadVideo, Sequence, continueRender, delayRender, interpolate, spring, staticFile,
  useCurrentFrame, useVideoConfig,
} from 'remotion'
import { INTRO, LINKS, PROBLEM, STEPS, TECH } from './script'

export const FPS = 30
const INTRO_S = 5, PROBLEM_S = 8, TECH_S = 8, OUTRO_S = 6
const LIVE = 'hakdaar.vercel.app'

const stepFrames = (seg) => Math.round(((seg.end - seg.start) / (STEPS[seg.id]?.speed || 1)) * FPS)
export const totalFrames = (data) =>
  (INTRO_S + PROBLEM_S + TECH_S + OUTRO_S) * FPS + data.segments.reduce((n, s) => n + stepFrames(s), 0)

const C = { bg: '#000', fg: '#fff', fg2: '#c8c8c8', muted: '#8e8e8e', line: 'rgba(255,255,255,.12)', warn: '#f2b25c' }
const display = '"Geist Pixel Circle", monospace'
const sans = 'Inter, "Helvetica Neue", Arial, sans-serif'

function useFonts() {
  const [handle] = useState(() => delayRender('fonts'))
  useEffect(() => {
    const f = new FontFace('Geist Pixel Circle', `url(${staticFile('fonts/GeistPixel-Circle.woff2')})`)
    f.load().then((ff) => { document.fonts.add(ff); continueRender(handle) }).catch(() => continueRender(handle))
  }, [handle])
}

const fadeUp = (frame, delay = 0) => ({
  opacity: interpolate(frame - delay, [0, 12], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }),
  transform: `translateY(${interpolate(frame - delay, [0, 12], [18, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}px)`,
})

function Backdrop() {
  return <AbsoluteFill style={{ background: 'radial-gradient(1200px 700px at 50% 110%, #2a1f3a 0%, #000 70%)' }} />
}

function Logo({ size }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: '#000', border: '2px solid rgba(255,255,255,.4)',
      display: 'grid', placeItems: 'center' }}>
      <Img src={staticFile('logo.png')} style={{ width: size * 0.78, height: size * 0.78 }} />
    </div>
  )
}

function Intro() {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  const s = spring({ frame, fps, config: { damping: 14 } })
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 36, fontFamily: sans }}>
      <Backdrop />
      <div style={{ transform: `scale(${s})` }}><Logo size={200} /></div>
      <div style={{ ...fadeUp(frame, 10), fontFamily: display, fontSize: 150, color: C.fg }}>{INTRO.title}</div>
      <div style={{ ...fadeUp(frame, 22), fontSize: 46, color: C.fg2 }}>{INTRO.tagline}</div>
    </AbsoluteFill>
  )
}

function Problem() {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 220px', gap: 40, fontFamily: sans }}>
      <Backdrop />
      <div style={{ ...fadeUp(frame), fontSize: 30, letterSpacing: 4, color: C.muted, textTransform: 'uppercase' }}>The problem</div>
      {PROBLEM.map((line, i) => (
        <div key={line} style={{ ...fadeUp(frame, 20 + i * 45), fontSize: 62, lineHeight: 1.25, color: i === 2 ? C.warn : C.fg }}>{line}</div>
      ))}
    </AbsoluteFill>
  )
}

function Step({ seg, index, count, preview }) {
  const frame = useCurrentFrame()
  const step = STEPS[seg.id] || { title: seg.id, body: '' }
  const speed = step.speed || 1
  return (
    <AbsoluteFill style={{ fontFamily: sans }}>
      <Backdrop />
      <div style={{ position: 'absolute', left: (1920 - 1440) / 2, top: 36, width: 1440, height: 810, borderRadius: 28,
        overflow: 'hidden', border: `1px solid ${C.line}`, boxShadow: '0 30px 80px rgba(0,0,0,.6)' }}>
        <OffthreadVideo src={staticFile('recording.webm')} startFrom={Math.round(seg.start * FPS)}
          playbackRate={speed} muted style={{ width: 1440, height: 810 }} />
      </div>
      <div style={{ position: 'absolute', left: 240, right: 240, top: 872, ...fadeUp(frame, 4) }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 22 }}>
          <span style={{ fontFamily: display, fontSize: 30, color: C.muted }}>{String(index + 1).padStart(2, '0')}/{String(count).padStart(2, '0')}</span>
          <span style={{ fontSize: 50, fontWeight: 600, color: C.fg }}>{step.title}</span>
        </div>
        <div style={{ marginTop: 10, fontSize: 32, lineHeight: 1.35, color: C.fg2 }}>{step.body}</div>
      </div>
      {preview && (
        <div style={{ position: 'absolute', right: 40, bottom: 30, padding: '10px 20px', borderRadius: 999, background: C.warn,
          color: '#000', fontSize: 24, fontWeight: 700 }}>PREVIEW · test server, not the live AI</div>
      )}
    </AbsoluteFill>
  )
}

function Tech() {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ justifyContent: 'center', padding: '0 220px', gap: 44, fontFamily: sans }}>
      <Backdrop />
      <div style={{ ...fadeUp(frame), fontSize: 30, letterSpacing: 4, color: C.muted, textTransform: 'uppercase' }}>How it works</div>
      {TECH.map(([name, what], i) => (
        <div key={name} style={{ ...fadeUp(frame, 18 + i * 30), display: 'flex', gap: 40, alignItems: 'baseline' }}>
          <span style={{ fontFamily: display, fontSize: 64, color: C.fg, minWidth: 560 }}>{name}</span>
          <span style={{ fontSize: 40, color: C.fg2 }}>{what}</span>
        </div>
      ))}
    </AbsoluteFill>
  )
}

function Outro() {
  const frame = useCurrentFrame()
  return (
    <AbsoluteFill style={{ alignItems: 'center', justifyContent: 'center', gap: 30, fontFamily: sans }}>
      <Backdrop />
      <div style={fadeUp(frame)}><Logo size={150} /></div>
      <div style={{ ...fadeUp(frame, 8), fontFamily: display, fontSize: 110, color: C.fg }}>HakDaar</div>
      {LINKS.map((l, i) => (
        <div key={l} style={{ ...fadeUp(frame, 18 + i * 10), fontSize: 42, color: C.fg2 }}>{l}</div>
      ))}
    </AbsoluteFill>
  )
}

export const Demo = ({ data }) => {
  useFonts()
  const preview = !String(data.source || '').includes(LIVE)
  let at = 0
  const next = (frames) => { const from = at; at += frames; return { from, durationInFrames: frames } }
  return (
    <AbsoluteFill style={{ background: C.bg }}>
      <Sequence {...next(INTRO_S * FPS)}><Intro /></Sequence>
      <Sequence {...next(PROBLEM_S * FPS)}><Problem /></Sequence>
      {data.segments.map((seg, i) => (
        <Sequence key={seg.id} {...next(stepFrames(seg))}>
          <Step seg={seg} index={i} count={data.segments.length} preview={preview} />
        </Sequence>
      ))}
      <Sequence {...next(TECH_S * FPS)}><Tech /></Sequence>
      <Sequence {...next(OUTRO_S * FPS)}><Outro /></Sequence>
    </AbsoluteFill>
  )
}
