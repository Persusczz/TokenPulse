import { useEffect, useRef } from 'react'
import type { Intensity } from '@shared/types'
import type { MotionScale } from '../state'
import { onFrame } from '../frames'

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`

/** Domain-warped noise in four palette colours, plus a light ring for new usage */
const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uC1, uC2, uC3, uC4;
uniform float uGlow;
uniform float uPulse;
uniform vec2 uPulsePos;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
void main() {
  float aspect = uRes.x / uRes.y;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * vec2(aspect, 1.0) * 1.5;
  float t = uTime * 0.06;
  vec2 q = vec2(fbm(p + vec2(0.0, t)), fbm(p + vec2(5.2, 1.3) - t));
  vec2 r = vec2(fbm(p + 3.0 * q + vec2(1.7, 9.2) + 1.3 * t), fbm(p + 3.0 * q + vec2(8.3, 2.8) - 1.1 * t));
  float f = fbm(p + 2.6 * r);
  vec3 col = mix(uC1, uC2, clamp(f * f * 2.4, 0.0, 1.0));
  col = mix(col, uC3, clamp(length(q) * 0.85 - 0.25, 0.0, 1.0));
  col = mix(col, uC4, clamp(r.x * r.x * 1.4, 0.0, 1.0));
  float d = distance(uv * vec2(aspect, 1.0), uPulsePos * vec2(aspect, 1.0));
  float ring = uPulse * exp(-pow((d - (1.0 - uPulse) * 1.1) * 7.0, 2.0));
  col = mix(col, vec3(1.0), ring * 0.45);
  float a = clamp(uGlow * (0.35 + 0.75 * f) + ring * 0.25, 0.0, 1.0);
  gl_FragColor = vec4(col * a, a);
}`

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
/** canvas resolution relative to the window: the picture is soft anyway */
const RES = 0.5
const FPS = 30

/**
 * Flowing light behind the window, drawn by a fragment shader at half
 * resolution and ~30 fps. Faster with usage intensity; each `pulse` sends a
 * ring of light across it. Draws one still frame when motion is off.
 */
export function FlowField({
  colors,
  glow,
  intensity,
  level,
  pulse,
  pixelScale = 1
}: {
  colors: [string, string, string, string]
  glow: number
  intensity: Intensity
  level: MotionScale
  pulse: number
  /** extra resolution when the page is CSS-zoomed */
  pixelScale?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({ colors, glow, intensity, pulseAt: -1e9, pulsePos: [0.5, 0.7] as [number, number], draw: () => {} })
  st.current.colors = colors
  st.current.glow = glow
  st.current.intensity = intensity

  useEffect(() => {
    if (!pulse || !level) return
    st.current.pulseAt = performance.now()
    st.current.pulsePos = [0.3 + Math.random() * 0.45, 0.45 + Math.random() * 0.4]
  }, [pulse]) // eslint-disable-line react-hooks/exhaustive-deps

  // a colour or strength change redraws the still frame
  useEffect(() => {
    if (!level) st.current.draw()
  }, [colors.join(), glow, level]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const canvas = ref.current!
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true, powerPreference: 'low-power' })
    if (!gl) return
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERT))
    gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAG))
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return
    gl.useProgram(prog)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const loc = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(loc)
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
    const u = (n: string) => gl.getUniformLocation(prog, n)
    const U = { res: u('uRes'), time: u('uTime'), c: [u('uC1'), u('uC2'), u('uC3'), u('uC4')], glow: u('uGlow'), pulse: u('uPulse'), pos: u('uPulsePos') }

    const s = st.current
    let time = 37
    // sized from its own box, so the floating window's panel can host one too
    const resize = () => {
      const dpr = (window.devicePixelRatio || 1) * RES * pixelScale
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr))
      gl.viewport(0, 0, canvas.width, canvas.height)
      s.draw()
    }
    s.draw = () => {
      gl.uniform2f(U.res, canvas.width, canvas.height)
      gl.uniform1f(U.time, time)
      s.colors.forEach((c, i) => gl.uniform3fv(U.c[i], rgb(c)))
      gl.uniform1f(U.glow, s.glow)
      gl.uniform1f(U.pulse, Math.max(0, 1 - (performance.now() - s.pulseAt) / 1800))
      gl.uniform2f(U.pos, s.pulsePos[0], s.pulsePos[1])
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    if (!level) return () => ro.disconnect()

    const stop = onFrame(
      FPS,
      (dt) => {
        time += dt * (0.55 + s.intensity * 0.45) * (level >= 3 ? 1.3 : level === 1 ? 0.6 : 1)
        s.draw()
      },
      'flow'
    )
    return () => {
      stop()
      ro.disconnect()
    }
  }, [level, pixelScale])

  return <canvas ref={ref} className="flow-field" />
}
