/**
 * Sound effects synthesised with Web Audio (no audio files): a water drip for
 * new usage, chimes for quota thresholds, falling / rising tones for the guard
 * pausing and resuming, and a short fanfare for achievements.
 */
export type SoundKind = 'drip' | 'warn' | 'alarm' | 'pause' | 'resume' | 'achievement'

let ctx: AudioContext | null = null
let master: GainNode | null = null

function audio(volume: number): { ac: AudioContext; out: GainNode } {
  ctx ??= new AudioContext()
  if (!master) {
    master = ctx.createGain()
    master.connect(ctx.destination)
  }
  master.gain.value = Math.max(0, Math.min(1, volume)) * 0.6
  if (ctx.state === 'suspended') void ctx.resume()
  return { ac: ctx, out: master }
}

/** One enveloped oscillator; `glide` slides the pitch to that frequency */
function tone(ac: AudioContext, out: AudioNode, at: number, o: { freq: number; glide?: number; dur: number; type?: OscillatorType; gain?: number }) {
  const osc = ac.createOscillator()
  const g = ac.createGain()
  osc.type = o.type ?? 'sine'
  osc.frequency.setValueAtTime(o.freq, at)
  if (o.glide) osc.frequency.exponentialRampToValueAtTime(o.glide, at + o.dur)
  const peak = o.gain ?? 0.5
  g.gain.setValueAtTime(0.0001, at)
  g.gain.exponentialRampToValueAtTime(peak, at + 0.008)
  g.gain.exponentialRampToValueAtTime(0.0001, at + o.dur)
  osc.connect(g).connect(out)
  osc.start(at)
  osc.stop(at + o.dur + 0.02)
}

export function playSound(kind: SoundKind, volume: number): void {
  try {
    const { ac, out } = audio(volume)
    const t = ac.currentTime + 0.01
    switch (kind) {
      case 'drip':
        // a falling "plip" and a softer ring after it
        tone(ac, out, t, { freq: 1350 + Math.random() * 250, glide: 420, dur: 0.12, gain: 0.35 })
        tone(ac, out, t + 0.05, { freq: 900, glide: 700, dur: 0.18, gain: 0.08 })
        break
      case 'warn':
        tone(ac, out, t, { freq: 880, dur: 0.5, type: 'triangle', gain: 0.3 })
        tone(ac, out, t + 0.18, { freq: 1175, dur: 0.6, type: 'triangle', gain: 0.25 })
        break
      case 'alarm':
        for (let i = 0; i < 3; i++) tone(ac, out, t + i * 0.22, { freq: 988, dur: 0.18, type: 'square', gain: 0.12 })
        break
      case 'pause':
        tone(ac, out, t, { freq: 660, glide: 330, dur: 0.45, type: 'triangle', gain: 0.3 })
        break
      case 'resume':
        tone(ac, out, t, { freq: 330, glide: 660, dur: 0.35, type: 'triangle', gain: 0.3 })
        tone(ac, out, t + 0.3, { freq: 880, dur: 0.4, gain: 0.2 })
        break
      case 'achievement':
        ;[523, 659, 784, 1047].forEach((f, i) => tone(ac, out, t + i * 0.09, { freq: f, dur: 0.5, type: 'triangle', gain: 0.22 }))
        break
    }
  } catch {
    /* no audio device */
  }
}
