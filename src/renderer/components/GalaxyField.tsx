import { useEffect, useRef } from 'react'
import type { Intensity } from '@shared/types'
import type { MotionScale } from '../state'

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`

/** galaxy placement, shared by the shader and the star particles */
const TILT = 0.42
const INCL = 0.46
const WIND = 2.4
const PATTERN = 0.012
/** galaxy size relative to the window height */
const SCALE = 1.3

/** Deep space, nebula, the band of the Milky Way and a spiral galaxy's glow */
const FRAG = `
precision mediump float;
uniform vec2 uRes;
uniform float uTime;
uniform vec3 uC1, uC2, uC3, uC4;
uniform vec2 uCenter;
uniform vec2 uShift;
uniform float uDark, uGlow, uFlare, uHeat;
// wonders: centre (x, y) and radius, in window heights
uniform vec3 uHole, uPlanet, uPillar, uEye;
// supernova: position and progress 0-1 (0 = none)
uniform vec3 uNova;

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
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float capsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// premultiplied layering: light adds on the dark sky, and lays over the page in daylight
vec3 C;
float A;
void glow(vec3 c, float a) {
  a = clamp(a, 0.0, 1.0);
  if (uDark > 0.5) C += c * a;
  else { C = c * a + C * (1.0 - a); A = a + A * (1.0 - a); }
}
void ink(vec3 c, float a) {
  a = clamp(a, 0.0, 1.0);
  C = c * a + C * (1.0 - a);
  A = a + A * (1.0 - a);
}

/** Wonders over the sky: two nebulae, a ringed planet, a black hole and a supernova */
void wonders(vec2 p, float t) {
  bool dark = uDark > 0.5;
  vec2 sh = uShift * 0.6;

  // "Pillars of Creation": glowing gas with dark dust columns rising into it
  vec2 nd = (p - uPillar.xy - sh) / uPillar.z;
  float nr = length(nd);
  if (nr < 1.35) {
    float g1 = fbm(nd * 2.2 + vec2(t * 0.003, 0.0) + 11.0);
    float g2 = fbm(nd * 4.5 - g1 * 1.3 + 4.0);
    float fade = smoothstep(1.3, 0.25, nr);
    float gas = smoothstep(0.32, 0.9, g1 * 0.6 + g2 * 0.6) * fade;
    vec3 gc = mix(vec3(0.95, 0.32, 0.42), vec3(0.25, 0.72, 0.74), smoothstep(0.4, 0.8, g2));
    gc = mix(gc, vec3(1.0, 0.82, 0.45), smoothstep(0.72, 0.95, g1));
    glow(gc, gas * (dark ? 0.6 : 0.5) * uGlow);
    float d = min(capsule(nd, vec2(-0.44, -1.4), vec2(-0.36, 0.02), 0.1),
              min(capsule(nd, vec2(-0.04, -1.4), vec2(0.05, 0.42), 0.13), capsule(nd, vec2(0.4, -1.4), vec2(0.34, -0.1), 0.09)));
    d += (g2 - 0.5) * 0.13;
    float body = smoothstep(0.012, -0.02, d) * smoothstep(1.35, 0.7, nr);
    ink(dark ? vec3(0.045, 0.03, 0.045) : vec3(0.4, 0.28, 0.3), body * 0.88);
    // their sunlit edges
    glow(vec3(1.0, 0.78, 0.5), exp(-pow(d / 0.018, 2.0)) * smoothstep(-0.9, 0.2, nd.y) * fade * 0.7 * uGlow);
  }

  // the Helix ("Eye of God"): a red rim, a teal inner ring and a white dwarf in the middle
  vec2 ed = (p - uEye.xy - sh) / uEye.z;
  float er = length(ed);
  if (er < 1.7) {
    float ea = atan(ed.y, ed.x);
    float fil = 0.55 + 0.45 * noise(vec2(ea * 9.0, er * 5.0 + t * 0.02));
    float knots = pow(noise(vec2(ea * 38.0, 2.0)), 5.0) * smoothstep(0.55, 0.85, er) * smoothstep(1.25, 0.9, er);
    glow(vec3(1.0, 0.36, 0.24), exp(-pow((er - 1.0) / 0.22, 2.0)) * fil * 0.65 * uGlow);
    glow(vec3(0.3, 0.82, 0.9), (exp(-pow((er - 0.66) / 0.2, 2.0)) * fil * 0.5 + exp(-er * er * 3.0) * 0.28) * uGlow);
    glow(vec3(1.0, 0.7, 0.5), knots * 0.8 * uGlow);
    glow(vec3(1.0), exp(-er * er * 700.0));
  }

  // a ringed giant rising out of the corner
  vec2 pd = p - uPlanet.xy - sh;
  float PR = uPlanet.z;
  float pr = length(pd) / PR;
  if (pr < 2.4) {
    vec2 rr = pd * rot(0.36);
    float rd = length(vec2(rr.x, rr.y / 0.24)) / PR;
    float rings = smoothstep(1.28, 1.33, rd) * smoothstep(2.3, 2.18, rd) * (0.6 + 0.4 * sin(rd * 70.0)) * (1.0 - 0.85 * smoothstep(1.74, 1.76, rd) * smoothstep(1.84, 1.82, rd));
    vec3 ringCol = dark ? vec3(0.92, 0.8, 0.62) : vec3(0.72, 0.55, 0.38);
    if (rr.y >= 0.0) glow(ringCol, rings * 0.55 * uGlow);
    if (pr < 1.0) {
      vec3 n3 = vec3(pd / PR, sqrt(max(0.0, 1.0 - pr * pr)));
      float lit = clamp(dot(n3, normalize(vec3(-0.65, 0.5, 0.58))), 0.0, 1.0);
      float bands = sin(pd.y / PR * 16.0 + fbm(pd / PR * 3.0 + t * 0.002) * 3.5);
      vec3 pc = mix(vec3(0.86, 0.62, 0.42), vec3(0.55, 0.38, 0.32), 0.5 + 0.5 * bands);
      pc = mix(pc, uC2, 0.2);
      ink(pc * (0.06 + lit * 1.05), smoothstep(1.0, 0.985, pr));
    }
    if (rr.y < 0.0) glow(ringCol, rings * 0.7 * uGlow);
    glow(vec3(0.5, 0.7, 1.0), exp(-pow((pr - 1.0) * 30.0, 2.0)) * 0.5 * uGlow);
  }

  // a black hole: lensed light over and under the shadow, then the disk in front of it
  vec2 hd = p - uHole.xy - sh;
  float R = uHole.z;
  float hl = length(hd) / R;
  if (hl < 7.0) {
    vec2 hr = hd * rot(-0.18);
    float ang = atan(hr.y, hr.x);
    float halo = exp(-pow((hl - 1.5) / 0.42, 2.0)) * (0.55 + 0.45 * noise(vec2(ang * 5.0 - t * 0.9, hl * 3.0)));
    vec3 hot = vec3(1.0, 0.72, 0.4);
    glow(hot, halo * 0.75 * uGlow);
    ink(dark ? vec3(0.0) : vec3(0.06, 0.05, 0.09), smoothstep(1.02, 0.97, hl));
    vec2 dp = vec2(hr.x, hr.y / 0.2) / R;
    float r3 = length(dp);
    float behind = step(hl, 1.0) * step(0.0, hr.y);
    float diskD = smoothstep(1.6, 1.95, r3) * smoothstep(5.6, 2.6, r3) * (1.0 - behind);
    float swirl = 0.55 + 0.45 * noise(vec2(atan(dp.y, dp.x) * 4.0 - t * 1.4 / r3, r3 * 3.0));
    float doppler = 1.0 + 0.7 * clamp(-hr.x / (5.0 * R), -1.0, 1.0);
    vec3 diskCol = mix(vec3(1.0, 0.5, 0.18), vec3(1.0, 0.94, 0.8), smoothstep(4.0, 1.8, r3));
    glow(diskCol, diskD * swirl * doppler * 0.9 * uGlow);
    glow(vec3(1.0, 0.92, 0.8), exp(-pow((hl - 1.06) * 16.0, 2.0)) * 0.9);
  }

  // supernova: a flash, then a shell racing outward
  if (uNova.z > 0.0) {
    float pz = uNova.z;
    vec2 vd = p - uNova.xy;
    float vr = length(vd);
    float shell = exp(-pow((vr - pz * 0.28) / (0.008 + pz * 0.02), 2.0)) * (1.0 - pz) * (0.6 + 0.4 * noise(vec2(atan(vd.y, vd.x) * 10.0, pz * 4.0)));
    glow(mix(vec3(1.0), vec3(0.45, 0.85, 1.0), pz), shell * 1.3);
    glow(vec3(1.0, 0.85, 0.95), exp(-vr * vr * 900.0 / (0.3 + pz)) * pow(1.0 - pz, 2.0) * 2.0);
    glow(vec3(0.9, 0.4, 0.8), exp(-vr * vr * 60.0) * (1.0 - pz) * pz * 1.6);
  }
}

void main() {
  float aspect = uRes.x / uRes.y;
  vec2 uv = gl_FragCoord.xy / uRes;
  vec2 p = uv * vec2(aspect, 1.0);
  float t = uTime;

  // nebula clouds
  vec2 q = p * 1.35 + uShift * 0.5 + vec2(t * 0.004, -t * 0.003);
  float n1 = fbm(q);
  float n2 = fbm(q * 2.3 + n1 * 1.7 + vec2(3.1, 7.7) - t * 0.006);
  float neb = smoothstep(0.4, 0.95, n1 * 0.55 + n2 * 0.65);
  vec3 nebc = mix(uC1, uC3, smoothstep(0.3, 0.8, n2));
  nebc = mix(nebc, uC4, smoothstep(0.55, 0.95, n1));

  // the Milky Way: a soft band across the window with dark dust lanes
  vec2 c0 = p - vec2(aspect * 0.5, 0.5) + uShift * 0.3;
  float across = dot(c0, normalize(vec2(0.55, 1.0)));
  float band = exp(-pow(across * 2.6 + (fbm(p * 2.2 + 5.0) - 0.5) * 0.8, 2.0));
  float lane = smoothstep(0.5, 0.74, fbm(p * 6.0 + vec2(1.3, 2.1)));

  // spiral galaxy, tilted and inclined
  vec2 g = (p - uCenter * vec2(aspect, 1.0) - uShift) * rot(${TILT.toFixed(3)}) / ${SCALE.toFixed(3)};
  g.y /= ${INCL.toFixed(3)};
  float r = length(g);
  float a = atan(g.y, g.x);
  float spiral = a - log(r + 0.02) * ${WIND.toFixed(3)} + t * ${PATTERN.toFixed(4)};
  float arms = pow(0.5 + 0.5 * cos(2.0 * spiral), 2.5);
  float dust = fbm(g * 7.0 + vec2(t * 0.01, 0.0));
  float disk = exp(-r * 5.5) * (0.22 + 0.95 * arms * (0.55 + 0.8 * dust));
  float core = exp(-r * r * 140.0) * 0.95 + exp(-r * 16.0) * 0.4;
  float ring = exp(-pow((r - (1.0 - uFlare) * 0.95) * 9.0, 2.0)) * uFlare;
  float flare = uFlare * exp(-r * r * 35.0) * 0.9 + ring * 0.55;
  vec3 coreCol = vec3(1.0, 0.9, 0.74);
  vec3 armCol = mix(uC2, vec3(0.58, 0.7, 1.0), 0.45);

  if (uDark > 0.5) {
    vec3 space = mix(vec3(0.010, 0.012, 0.032), vec3(0.045, 0.026, 0.075), uv.y);
    vec3 col = space;
    col += nebc * neb * 0.5 * uGlow;
    col += vec3(0.72, 0.76, 0.95) * band * 0.11 * uGlow * (1.0 - lane * 0.75);
    // a soft roll-off instead of clipping, so the core and flares bloom without going flat white
    vec3 light = (armCol * disk + coreCol * (core + flare)) * uGlow;
    col += 1.0 - exp(-light * 1.25);
    col += vec3(0.55, 0.1, 0.08) * uHeat * 0.22 * (1.0 - uv.y);
    A = 0.94;
    C = min(col, vec3(1.0)) * A;
  } else {
    // daylight: colour only where there is gas or galaxy, the page shows through elsewhere
    float wN = neb * 0.36, wB = band * 0.3 * (1.0 - lane * 0.6), wG = disk * 1.25 + core * 1.2 + flare;
    vec3 bandCol = vec3(0.5, 0.56, 0.92);
    vec3 col = (nebc * wN + bandCol * wB + mix(armCol, vec3(0.95, 0.6, 0.3), clamp(core / (disk + core + 0.001), 0.0, 1.0)) * wG) / (wN + wB + wG + 0.0001);
    A = clamp((wN + wB + wG) * uGlow, 0.0, 0.82);
    C = col * A;
  }
  wonders(p, t);
  gl_FragColor = vec4(min(C, vec3(A)), A);
}`

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

interface Bg {
  x: number
  y: number
  r: number
  a: number
  depth: number
  phase: number
  tw: number
  spike: boolean
}
interface GStar {
  /** distance from the centre, in window heights */
  r: number
  ang: number
  wob: number
  wobF: number
  size: number
  bucket: number
}
interface Meteor {
  x: number
  y: number
  vx: number
  vy: number
  life: number
  max: number
  len: number
  /** seconds before it appears (showers are staggered) */
  delay: number
}

/** a speck of the black hole's accretion disk: orbit radius in shadow radii */
interface Speck {
  r3: number
  phi: number
  w: number
  size: number
  a: number
}
interface Comet {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
}

const RES = 0.5
const DENSITY: Record<MotionScale, number> = { 0: 0.8, 1: 0.6, 2: 1, 3: 1.35 }
const NOVA_MS = 3400
/** a page change: the stars stretch into lines and snap back */
const WARP_MS = 1050
const WARP_PEAK = 0.35
const smooth = (a: number, b: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return k * k * (3 - 2 * k)
}

/**
 * Where the wonders sit, in css px: the black hole in the sidebar's open
 * middle, a ringed planet rising from the bottom-right corner, the pillars
 * nebula low in the middle and the Helix on the right.
 */
function layout(w: number, h: number) {
  return {
    hole: { x: Math.min(w * 0.085, 140), y: h * 0.6, r: h * 0.034 },
    planet: { x: w * 0.985, y: h * 1.08, r: h * 0.33 },
    pillar: { x: w * 0.38, y: h * 0.95, r: h * 0.34 },
    eye: { x: w * 0.9, y: h * 0.74, r: h * 0.085 }
  }
}
/** galaxy star colours (dark page / light page) and alpha levels: bucket = colour * 3 + level */
const DARK_COLS = ['#fff3dc', '#cfe0ff', '#9fb8ff', '#ffd2ec', '#ffffff']
const LIGHT_COLS = ['#a8642c', '#4b6fd6', '#6a54d0', '#c04f8e', '#3a3550']
const LEVELS = [0.35, 0.6, 0.95]

const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5

/**
 * "宇宙星河": deep space with a slowly turning spiral galaxy. A shader paints
 * the nebula, the Milky Way and the galaxy's glow; thousands of crisp stars
 * ride the same spiral arms, background stars twinkle in three depths and
 * meteors cross now and then. Each `pulse` (new usage) flares the core and
 * sends a meteor shower sized by the batch; rich motion adds pointer parallax.
 */
export function GalaxyField({
  colors,
  intensity,
  level,
  pulse,
  size,
  dark,
  vivid,
  heat
}: {
  colors: [string, string, string, string]
  intensity: Intensity
  level: MotionScale
  pulse: number
  /** tokens behind `pulse` */
  size: number
  dark: boolean
  vivid: number
  heat: number
}) {
  const glRef = useRef<HTMLCanvasElement>(null)
  const ref = useRef<HTMLCanvasElement>(null)
  const st = useRef({
    colors,
    intensity,
    level,
    dark,
    vivid,
    heat,
    t: 40,
    flareAt: -1e9,
    bg: [] as Bg[],
    stars: [] as GStar[],
    meteors: [] as Meteor[],
    nextMeteor: 4,
    disk: [] as Speck[],
    comet: null as Comet | null,
    nextComet: 20,
    novaAt: -1e9,
    novaPos: { x: 0, y: 0 },
    warpAt: -1e9,
    /** streaks flying out of the centre during a warp: angle, start distance (0–1), speed */
    warp: [] as { a: number; d: number; v: number; w: number }[],
    w: 0,
    h: 0,
    pointer: { x: 0.5, y: 0.5 },
    shift: { x: 0, y: 0 },
    draw: (_dt: number) => {},
    spawn: (_n: number) => {}
  })
  Object.assign(st.current, { colors, intensity, level, dark, vivid, heat })

  // new usage: the core flares and meteors fall, more for bigger batches
  useEffect(() => {
    const s = st.current
    if (!pulse || !level || !s.w) return
    s.flareAt = performance.now()
    s.spawn(Math.max(1, Math.min(level >= 3 ? 7 : 4, Math.round(Math.log10(size + 10) - 2))))
  }, [pulse]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!level) st.current.draw(0)
  }, [colors.join(), dark, vivid, level]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const glCanvas = glRef.current!
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')!
    const s = st.current
    let dpr = 1

    // ---- shader layer
    const gl = glCanvas.getContext('webgl', { premultipliedAlpha: true, antialias: false, alpha: true, powerPreference: 'low-power' })
    let shade: (() => void) | null = null
    if (gl) {
      const sh = (type: number, src: string) => {
        const x = gl.createShader(type)!
        gl.shaderSource(x, src)
        gl.compileShader(x)
        return x
      }
      const prog = gl.createProgram()!
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT))
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG))
      gl.linkProgram(prog)
      if (gl.getProgramParameter(prog, gl.LINK_STATUS)) {
        gl.useProgram(prog)
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
        const loc = gl.getAttribLocation(prog, 'p')
        gl.enableVertexAttribArray(loc)
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
        const u = (n: string) => gl.getUniformLocation(prog, n)
        const U = {
          res: u('uRes'),
          time: u('uTime'),
          c: [u('uC1'), u('uC2'), u('uC3'), u('uC4')],
          center: u('uCenter'),
          shift: u('uShift'),
          dark: u('uDark'),
          glow: u('uGlow'),
          flare: u('uFlare'),
          heat: u('uHeat'),
          hole: u('uHole'),
          planet: u('uPlanet'),
          pillar: u('uPillar'),
          eye: u('uEye'),
          nova: u('uNova')
        }
        // css px -> the shader's space (window heights, y up)
        const put = (loc: WebGLUniformLocation | null, o: { x: number; y: number; r: number }) => gl.uniform3f(loc, o.x / s.h, 1 - o.y / s.h, o.r / s.h)
        shade = () => {
          gl.viewport(0, 0, glCanvas.width, glCanvas.height)
          gl.uniform2f(U.res, glCanvas.width, glCanvas.height)
          gl.uniform1f(U.time, s.t)
          s.colors.forEach((c, i) => gl.uniform3fv(U.c[i], rgb(c)))
          const c = center()
          gl.uniform2f(U.center, c.x / s.w, 1 - c.y / s.h)
          gl.uniform2f(U.shift, s.shift.x, -s.shift.y)
          gl.uniform1f(U.dark, s.dark ? 1 : 0)
          gl.uniform1f(U.glow, 0.55 + s.vivid * 0.7)
          gl.uniform1f(U.flare, flare())
          gl.uniform1f(U.heat, s.heat)
          const L = layout(s.w, s.h)
          put(U.hole, L.hole)
          put(U.planet, L.planet)
          put(U.pillar, L.pillar)
          put(U.eye, L.eye)
          const nova = (performance.now() - s.novaAt) / NOVA_MS
          gl.uniform3f(U.nova, s.novaPos.x / s.h, 1 - s.novaPos.y / s.h, nova > 0 && nova < 1 ? nova : 0)
          gl.clearColor(0, 0, 0, 0)
          gl.clear(gl.COLOR_BUFFER_BIT)
          gl.drawArrays(gl.TRIANGLES, 0, 3)
        }
      }
    }

    const flare = () => Math.max(0, 1 - (performance.now() - s.flareAt) / 2200)
    /** galaxy centre in css px: in the open band above the cards, right of the page title */
    const center = () => ({ x: s.w * 0.62, y: Math.min(s.h * 0.16, 170) })

    const seed = () => {
      const area = s.w * s.h
      const k = DENSITY[s.level]
      s.bg = Array.from({ length: Math.round((area / 2600) * k) }, () => ({
        x: Math.random() * s.w,
        y: Math.random() * s.h,
        r: 0.4 + Math.random() ** 3 * 1.4,
        a: 0.35 + Math.random() * 0.65,
        depth: [0.25, 0.55, 1][Math.floor(Math.random() * 3)],
        phase: Math.random() * 6.28,
        tw: 0.5 + Math.random() * 2.5,
        spike: Math.random() < 0.012
      }))
      const n = Math.round(Math.min(6000, Math.max(1800, area / 300)) * k)
      s.stars = Array.from({ length: n }, () => {
        const inArm = Math.random() < 0.72
        // exponential disk, truncated
        const r = -Math.log(1 - Math.random() * (1 - Math.exp(-0.62 * 5.2))) / 5.2
        const arm = Math.random() < 0.5 ? 0 : Math.PI
        const ang = inArm ? Math.log(r + 0.02) * WIND + arm + gauss() * (0.22 + r * 0.35) : Math.random() * Math.PI * 2
        const core = r < 0.045
        const pink = !core && inArm && Math.random() < 0.035
        const colour = core ? 0 : pink ? 3 : Math.random() < 0.12 ? 4 : Math.random() < 0.55 ? 1 : 2
        const lvl = core ? 2 : Math.random() < 0.15 ? 2 : Math.random() < 0.5 ? 1 : 0
        return { r: r * (1 + gauss() * 0.05), ang, wob: Math.random() * 6.28, wobF: 0.1 + Math.random() * 0.4, size: core ? 1.4 : 0.6 + Math.random() ** 2 * 1.3, bucket: colour * 3 + lvl }
      }).sort((a, b) => a.bucket - b.bucket)
      // young bright stars around the pillars' tops, fixed in place
      const L = layout(s.w, s.h)
      for (let i = 0; i < 26 * k; i++) {
        s.bg.push({
          x: L.pillar.x + gauss() * L.pillar.r * 0.6,
          y: L.pillar.y - L.pillar.r * (0.55 + Math.random() * 0.5),
          r: 0.9 + Math.random() * 1.2,
          a: 0.7 + Math.random() * 0.3,
          depth: 0,
          phase: Math.random() * 6.28,
          tw: 1 + Math.random() * 2,
          spike: Math.random() < 0.3
        })
      }
      s.disk = Array.from({ length: Math.round(240 * k) }, () => {
        const r3 = 1.75 + 3.4 * Math.random() ** 1.6
        return { r3, phi: Math.random() * Math.PI * 2, w: 1.5 / r3 ** 1.5, size: 0.7 + Math.random() * 1.1, a: 0.4 + Math.random() * 0.6 }
      })
    }

    // today's tokens passing a milestone: a supernova and a ring of debris
    const nova = () => {
      if (!s.level || !s.w) return
      const spots = [
        { x: s.w * 0.42, y: s.h * 0.08 },
        { x: s.w * 0.09, y: s.h * 0.86 },
        { x: s.w * 0.86, y: s.h * 0.1 }
      ]
      s.novaPos = spots[Math.floor(Math.random() * spots.length)]
      s.novaAt = performance.now()
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2 + Math.random() * 0.1
        const v = 160 + Math.random() * 300
        const life = 1.2 + Math.random() * 1
        s.meteors.push({ x: s.novaPos.x, y: s.novaPos.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life, max: life, len: 14 + Math.random() * 30, delay: 0.15 })
      }
    }
    document.addEventListener('tp-nova', nova)
    // lets the walkthrough call the next comet in now
    document.addEventListener('tp-comet', () => (s.nextComet = 0))
    // switching pages: a jump through hyperspace
    const warp = () => {
      if (!s.level || !s.w) return
      s.warpAt = performance.now()
      s.warp = Array.from({ length: Math.round(170 * DENSITY[s.level]) }, () => ({ a: Math.random() * Math.PI * 2, d: Math.random() ** 1.5 * 0.5, v: 0.7 + Math.random() * 1.6, w: 0.6 + Math.random() * 1.6 }))
      // the core flares as we arrive
      s.flareAt = performance.now() + WARP_MS * 0.45
      if (!s.level) s.draw(0)
    }
    document.addEventListener('tp-warp', warp)

    s.spawn = (n: number) => {
      for (let i = 0; i < n; i++) {
        const a = Math.PI * (0.62 + Math.random() * 0.16)
        const v = 800 + Math.random() * 500
        const life = 0.8 + Math.random() * 0.6
        s.meteors.push({
          x: s.w * (0.25 + Math.random() * 0.8),
          y: -20 + Math.random() * s.h * 0.2,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v,
          life,
          max: life,
          len: 110 + Math.random() * 170,
          delay: i * (0.18 + Math.random() * 0.2)
        })
      }
    }

    const resize = () => {
      dpr = window.devicePixelRatio || 1
      s.w = canvas.clientWidth
      s.h = canvas.clientHeight
      canvas.width = Math.round(s.w * dpr)
      canvas.height = Math.round(s.h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      glCanvas.width = Math.max(1, Math.round(s.w * dpr * RES))
      glCanvas.height = Math.max(1, Math.round(s.h * dpr * RES))
      seed()
      s.draw(0)
    }

    const tilt = { c: Math.cos(TILT), s: Math.sin(TILT) }
    s.draw = (dt: number) => {
      const { w, h } = s
      if (!w || !h) return
      s.t += dt * (0.6 + s.intensity * 0.4) * (s.level >= 3 ? 1.3 : s.level === 1 ? 0.6 : 1)
      // pointer parallax eases toward its target
      if (s.level >= 3) {
        const k = 1 - Math.exp(-dt * 2)
        s.shift.x += ((s.pointer.x - 0.5) * 0.025 - s.shift.x) * k
        s.shift.y += ((s.pointer.y - 0.5) * 0.025 - s.shift.y) * k
      }
      shade?.()

      const f = flare()
      const lighter = s.dark
      ctx.clearRect(0, 0, w, h)
      ctx.globalCompositeOperation = lighter ? 'lighter' : 'source-over'

      // background stars in three depths, never in front of the black hole or the planet
      const L = layout(w, h)
      const wsx = s.shift.x * h * 0.6
      const wsy = s.shift.y * h * 0.6
      const hole = { x: L.hole.x + wsx, y: L.hole.y + wsy, r: L.hole.r }
      const planet = { x: L.planet.x + wsx, y: L.planet.y + wsy, r: L.planet.r }
      const drift = s.t * 2.2
      // warp: 0 → 1 at the peak → 0, centred on the page area
      const wp = (performance.now() - s.warpAt) / WARP_MS
      const warpK = wp > 0 && wp < 1 ? (wp < WARP_PEAK ? smooth(0, WARP_PEAK, wp) : 1 - smooth(WARP_PEAK, 1, wp)) : 0
      const wcx = w * 0.58
      const wcy = h * 0.45
      ctx.fillStyle = s.dark ? '#ffffff' : '#5b4d6e'
      if (warpK > 0) {
        ctx.lineCap = 'round'
        ctx.strokeStyle = s.dark ? '#ffffff' : '#5b4d6e'
      }
      for (const b of s.bg) {
        const x = (((b.x - drift * b.depth - s.shift.x * h * 1.6 * b.depth) % w) + w) % w
        const y = b.y - s.shift.y * h * 1.6 * b.depth
        if ((x - hole.x) ** 2 + (y - hole.y) ** 2 < (hole.r * 1.1) ** 2 || (x - planet.x) ** 2 + (y - planet.y) ** 2 < planet.r ** 2) continue
        const tw = 0.55 + 0.45 * Math.sin(s.t * b.tw + b.phase)
        ctx.globalAlpha = b.a * tw * (s.dark ? 1 : 0.45)
        const r = b.r * (s.dark ? 1 : 0.9)
        if (warpK > 0.02) {
          // stretched along the line from the centre: farther stars streak longer
          const k = warpK * (0.25 + b.depth * 0.55)
          ctx.globalAlpha = Math.min(1, b.a * (0.6 + warpK) * (s.dark ? 1 : 0.6))
          ctx.lineWidth = r * (1 + warpK * 0.6)
          ctx.beginPath()
          ctx.moveTo(x - (x - wcx) * k * 0.15, y - (y - wcy) * k * 0.15)
          ctx.lineTo(x + (x - wcx) * k, y + (y - wcy) * k)
          ctx.stroke()
          continue
        }
        ctx.fillRect(x - r / 2, y - r / 2, r, r)
        if (b.spike && s.dark) {
          ctx.globalAlpha = b.a * tw * 0.5
          ctx.fillRect(x - 6, y - 0.4, 12, 0.8)
          ctx.fillRect(x - 0.4, y - 6, 0.8, 12)
        }
      }

      // the galaxy's stars ride the turning spiral
      const c = center()
      const cx = c.x + s.shift.x * h
      const cy = c.y + s.shift.y * h
      const spin = -s.t * PATTERN
      const cols = s.dark ? DARK_COLS : LIGHT_COLS
      const boost = (s.dark ? 1 : 0.95) * (0.75 + s.vivid * 0.4) * (1 + f * 0.8)
      // sorted by colour bucket: the style changes only between runs
      let cur = -1
      for (const g of s.stars) {
        if (g.bucket !== cur) {
          cur = g.bucket
          ctx.fillStyle = cols[Math.floor(cur / 3)]
          ctx.globalAlpha = Math.min(1, LEVELS[cur % 3] * boost)
        }
        const a = g.ang + spin + Math.sin(s.t * g.wobF + g.wob) * 0.025
        const gx = Math.cos(a) * g.r
        const gy = Math.sin(a) * g.r * INCL
        ctx.fillRect(cx + (tilt.c * gx + tilt.s * gy) * h * SCALE, cy + (tilt.s * gx - tilt.c * gy) * h * SCALE, g.size, g.size)
      }

      // the accretion disk's specks, Keplerian: inner ones race, the near side brighter
      const rc = Math.cos(0.18)
      const rs = Math.sin(0.18)
      const speed = s.level >= 3 ? 1.3 : s.level === 1 ? 0.6 : 1
      ctx.fillStyle = s.dark ? '#ffd39c' : '#b4561e'
      for (const d of s.disk) {
        d.phi += dt * d.w * speed
        const x3 = Math.cos(d.phi) * d.r3 * hole.r
        const y3 = Math.sin(d.phi) * d.r3 * hole.r * 0.2
        const dx = rc * x3 - rs * y3
        const dy = rs * x3 + rc * y3
        if (y3 > 0 && dx * dx + dy * dy < hole.r * hole.r) continue
        ctx.globalAlpha = Math.min(1, d.a * (1 + 0.7 * Math.max(-1, Math.min(1, -x3 / (5 * hole.r)))) * (s.dark ? 0.9 : 0.7))
        ctx.fillRect(hole.x + dx, hole.y - dy, d.size, d.size)
      }

      // hyperspace: light lines rushing out of the centre
      if (warpK > 0.01 && s.warp.length) {
        const R = Math.hypot(w, h) * 0.62
        ctx.lineCap = 'round'
        for (const q of s.warp) {
          const d = (q.d + wp * q.v) % 1.15
          const r1 = d * R
          const r0 = r1 * (1 - 0.55 * warpK)
          const cos = Math.cos(q.a)
          const sin = Math.sin(q.a)
          ctx.globalAlpha = Math.min(1, warpK * (0.25 + d) * (s.dark ? 0.95 : 0.55))
          ctx.strokeStyle = s.dark ? (q.w > 1.6 ? '#cfe0ff' : '#ffffff') : '#4b3f80'
          ctx.lineWidth = q.w * (0.6 + d)
          ctx.beginPath()
          ctx.moveTo(wcx + cos * r0, wcy + sin * r0)
          ctx.lineTo(wcx + cos * r1, wcy + sin * r1)
          ctx.stroke()
        }
        // a soft flash at the heart of the jump
        const g = ctx.createRadialGradient(wcx, wcy, 0, wcx, wcy, h * 0.5)
        g.addColorStop(0, s.dark ? `rgba(190,215,255,${0.35 * warpK})` : `rgba(120,100,200,${0.18 * warpK})`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = 1
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }

      // a comet now and then, its tails streaming away from the galaxy's core
      if (s.level >= 2 && dt > 0) {
        s.nextComet -= dt
        if (!s.comet && s.nextComet <= 0) {
          // through the open band above the cards
          s.comet = { x: -60, y: Math.min(h * 0.1, 110) * (0.4 + Math.random() * 0.6), vx: 85 + Math.random() * 40, vy: Math.random() * 5, age: 0, life: (w + 160) / 80 }
          s.nextComet = 45 + Math.random() * 45
        }
      }
      if (s.comet) {
        const k = s.comet
        k.age += dt
        k.x += k.vx * dt
        k.y += k.vy * dt
        if (k.x > w + 120 || k.age > k.life * 1.6) s.comet = null
        else {
          const away = Math.atan2(k.y - cy, k.x - cx)
          const ux = Math.cos(away)
          const uy = Math.sin(away)
          const vl = Math.hypot(k.vx, k.vy)
          const tails: [string, number, number][] = s.dark
            ? [
                ['150, 205, 255', 230, 0],
                ['255, 220, 170', 170, 0.5]
              ]
            : [
                ['60, 110, 200', 210, 0],
                ['190, 110, 50', 150, 0.5]
              ]
          for (const [rgbc, len, bend] of tails) {
            for (let i = 0; i < 18; i++) {
              const a0 = i / 18
              const a1 = (i + 1) / 18
              const px = (q: number) => k.x + ux * len * q - (k.vx / vl) * len * bend * q * q
              const py = (q: number) => k.y + uy * len * q - (k.vy / vl) * len * bend * q * q
              ctx.globalAlpha = (1 - a0) ** 1.6 * (s.dark ? 0.75 : 0.55)
              ctx.strokeStyle = `rgb(${rgbc})`
              ctx.lineWidth = 4.2 * (1 - a0) + 0.5
              ctx.beginPath()
              ctx.moveTo(px(a0), py(a0))
              ctx.lineTo(px(a1), py(a1))
              ctx.stroke()
            }
          }
          const head = ctx.createRadialGradient(k.x, k.y, 0, k.x, k.y, 12)
          head.addColorStop(0, s.dark ? 'rgba(255,255,255,1)' : 'rgba(70,90,170,0.95)')
          head.addColorStop(1, 'rgba(160,210,255,0)')
          ctx.globalAlpha = 1
          ctx.fillStyle = head
          ctx.beginPath()
          ctx.arc(k.x, k.y, 12, 0, Math.PI * 2)
          ctx.fill()
        }
      }

      // meteors
      if (s.level >= 2 && dt > 0) {
        s.nextMeteor -= dt
        if (s.nextMeteor <= 0) {
          s.spawn(1)
          s.nextMeteor = (s.level >= 3 ? 4 : 7) + Math.random() * 7
        }
      }
      ctx.lineCap = 'round'
      s.meteors = s.meteors.filter((m) => {
        if (m.delay > 0) {
          m.delay -= dt
          return true
        }
        m.life -= dt
        if (m.life <= 0) return false
        m.x += m.vx * dt
        m.y += m.vy * dt
        const p = m.life / m.max
        const fade = Math.min(1, p * 2.5) * Math.min(1, (1 - p) * 8)
        const sp = Math.hypot(m.vx, m.vy)
        const tx = m.x - (m.vx / sp) * m.len
        const ty = m.y - (m.vy / sp) * m.len
        const grad = ctx.createLinearGradient(tx, ty, m.x, m.y)
        const head = s.dark ? '255,255,255' : '90,70,160'
        grad.addColorStop(0, `rgba(${head},0)`)
        grad.addColorStop(1, `rgba(${head},${(0.9 * fade).toFixed(3)})`)
        ctx.globalAlpha = 1
        ctx.strokeStyle = grad
        ctx.lineWidth = 1.6
        ctx.beginPath()
        ctx.moveTo(tx, ty)
        ctx.lineTo(m.x, m.y)
        ctx.stroke()
        ctx.globalAlpha = fade * 0.8
        ctx.fillStyle = s.dark ? '#ffffff' : '#5a46a0'
        ctx.beginPath()
        ctx.arc(m.x, m.y, 1.8, 0, Math.PI * 2)
        ctx.fill()
        return true
      })
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = 'source-over'
    }

    const ro = new ResizeObserver(resize)
    ro.observe(canvas)
    resize()
    const move = (e: PointerEvent) => (s.pointer = { x: e.clientX / (s.w || 1), y: e.clientY / (s.h || 1) })
    addEventListener('pointermove', move, { passive: true })
    if (!level) return () => (ro.disconnect(), removeEventListener('pointermove', move), document.removeEventListener('tp-nova', nova), document.removeEventListener('tp-warp', warp))

    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick)
      if (now - last < 24) return
      const dt = Math.min(0.06, (now - last) / 1000)
      last = now
      s.draw(dt)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      removeEventListener('pointermove', move)
      document.removeEventListener('tp-nova', nova)
      document.removeEventListener('tp-warp', warp)
    }
  }, [level])

  return (
    <>
      <canvas ref={glRef} className="galaxy-gl" />
      <canvas ref={ref} className="galaxy-stars" />
    </>
  )
}
