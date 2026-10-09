/**
 * The 项目星系 card's shader layer, under the 2D canvas: deep space as a slow
 * fluid of gas with ionised filaments, haze and dark dust, and under every
 * project's galaxy its own gas disk: flowing clouds along the arms, hot
 * ionised knots where the gas piles up, a bright fringe round the densest
 * clouds, dust lanes on the arms' inner edges and a soft halo. Each disk is
 * placed, tilted and turned exactly like the galaxy's sprite drawn above it.
 */

export const GAS_MAX = 8

export interface GasBody {
  /** centre and radius in CSS pixels, as on screen */
  x: number
  y: number
  r: number
  /** 0 hidden … 1 shown */
  fade: number
  squash: number
  tilt: number
  rot: number
  arms: number
  seed: number
  /** which way it turns: the gas flows the same way */
  spin: number
  /** 0 … 1 while flown into */
  focus: number
  /** "r,g,b" colours of the tool's palette, and its ionised glow 0–1 */
  mid: string
  arm: string
  ion: [number, number, number]
}

const VERT = `attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }`

const FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
#define MAX ${GAS_MAX}
uniform vec2 uRes;
uniform float uScale;
uniform float uTime;
uniform vec2 uDrift;
uniform float uInside;
uniform int uN;
uniform vec4 uG[MAX];
uniform vec4 uS[MAX];
uniform vec4 uK[MAX];
uniform vec3 uMid[MAX];
uniform vec3 uArm[MAX];
uniform vec3 uIon[MAX];

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
const mat2 M = mat2(0.8, -0.6, 0.6, 0.8);
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = M * p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
/** sharp creases: the thin bright threads of ionised gas */
float ridge(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { float n = 1.0 - abs(noise(p) * 2.0 - 1.0); v += a * n * n; p = M * p * 2.1 + vec2(3.1, 1.7); a *= 0.5; }
  return v;
}
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

void main() {
  // CSS pixels, y down, like the 2D canvas above
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec2 res = uRes / uScale;
  float t = uTime;

  // deep space: a slow fluid of gas, folded into itself
  vec2 p = (px + uDrift) / res.y * 2.4;
  vec2 q = vec2(fbm(p + vec2(0.0, t * 0.012)), fbm(p + vec2(5.2, 1.3) - t * 0.010));
  vec2 r = vec2(fbm(p + 3.5 * q + vec2(1.7, 9.2) + t * 0.018), fbm(p + 3.5 * q + vec2(8.3, 2.8) - t * 0.014));
  float f = fbm(p + 3.0 * r);
  vec3 col = mix(vec3(0.027, 0.031, 0.094), vec3(0.047, 0.055, 0.16), clamp(px.x / res.x * 0.6 + px.y / res.y * 0.4, 0.0, 1.0));
  vec3 violet = vec3(0.45, 0.28, 0.80), teal = vec3(0.14, 0.62, 0.72), rose = vec3(0.88, 0.36, 0.46);
  vec3 gasC = mix(violet, teal, clamp(length(q) * 0.9 - 0.2, 0.0, 1.0));
  gasC = mix(gasC, rose, clamp(r.x * r.x * 1.5 - 0.3, 0.0, 1.0));
  float dens = smoothstep(0.3, 1.0, f * f * 2.1);
  col += gasC * dens * 0.24;
  // ionised filaments threading the densest gas
  float fil = ridge(p * 2.2 + 2.0 * r);
  col += mix(teal, rose, r.y) * pow(fil, 4.0) * dens * 0.42;
  // haze: the band of light across the sky
  vec2 b = rot(0.32) * ((px - res * 0.5) / res.y);
  col += vec3(0.62, 0.58, 0.95) * exp(-b.y * b.y * 40.0) * 0.08 * (0.6 + 0.8 * f);
  // dust: dark lanes that swallow the light
  float dust = smoothstep(0.5, 0.78, fbm(p * 1.7 + 2.2 * q + 7.1));
  col *= 1.0 - 0.55 * dust;
  col *= 1.0 - 0.35 * uInside;

  for (int i = 0; i < MAX; i++) {
    if (i >= uN) break;
    vec4 G = uG[i];
    vec4 S = uS[i];
    vec4 K = uK[i];
    if (G.w < 0.01) continue;
    // into the galaxy's own plane: untilt, unsquash, unturn
    vec2 d = rot(-S.y) * (px - G.xy);
    d.y /= S.x;
    float u = length(d) / G.z;
    if (u > 1.8) continue;
    vec2 v = rot(-S.z) * d / G.z;
    float phi = atan(v.y, v.x) - 2.4 * log(1.0 + 5.0 * u);
    float arm = pow(0.5 + 0.5 * cos(S.w * phi), 2.5);
    float inner = pow(0.5 + 0.5 * cos(S.w * (phi - 0.42)), 6.0);
    // the gas flows: noise folded by noise that drifts with time
    vec2 sp = v * 3.2 + K.x * 37.0;
    float w = fbm(sp * 0.8 + vec2(t * 0.035, -t * 0.027) * K.y);
    float g = fbm(sp + 1.7 * w);
    float disk = smoothstep(1.45, 0.0, u);
    float fall = exp(-u * 2.4);
    vec3 c = vec3(0.0);
    float gas = (0.4 + 0.6 * arm) * smoothstep(0.25, 0.95, g + arm * 0.35) * disk;
    c += mix(uMid[i], uArm[i], 0.5 + 0.5 * g) * gas * (0.8 + 1.0 * fall);
    // ionised knots where the gas piles up on the arms
    float hii = smoothstep(0.62, 0.9, g * arm + w * 0.25) * smoothstep(0.15, 0.4, u) * disk;
    c += uIon[i] * hii * 1.5;
    // the ionised envelope: a faint glow breathing round the whole disk
    c += uIon[i] * exp(-u * 1.6) * (0.1 + 0.16 * w) * smoothstep(1.8, 0.6, u);
    // a thin bright fringe round the densest clouds
    float edge = ridge(sp * 1.3 + w);
    c += mix(uIon[i], vec3(0.78, 0.95, 1.0), 0.4) * pow(edge, 5.0) * arm * disk * 0.7;
    // haze: a soft halo, and the glowing bulge
    c += uMid[i] * exp(-u * u * 2.0) * 0.38;
    c += vec3(1.0, 0.96, 0.9) * exp(-u * u * 26.0) * 0.5;
    // dust lanes on the arms' inner edges
    float lane = inner * smoothstep(0.45, 0.8, fbm(sp * 1.6 - w)) * smoothstep(0.12, 0.3, u) * disk;
    float k = G.w * (1.0 + 0.35 * K.z);
    col = col * (1.0 - 0.75 * lane * G.w) + c * k * (1.0 - 0.65 * lane);
  }
  // a little grain keeps the gradients from banding
  col += (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
}`

const rgb = (s: string): [number, number, number] => {
  const [r, g, b] = s.split(',').map(Number)
  return [r / 255, g / 255, b / 255]
}

export class GalaxyGas {
  private gl: WebGLRenderingContext | null = null
  private loc: Record<string, WebGLUniformLocation | null> = {}
  private scale = 1
  private G = new Float32Array(GAS_MAX * 4)
  private S = new Float32Array(GAS_MAX * 4)
  private K = new Float32Array(GAS_MAX * 4)
  private mid = new Float32Array(GAS_MAX * 3)
  private arm = new Float32Array(GAS_MAX * 3)
  private ion = new Float32Array(GAS_MAX * 3)

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' })
    if (!gl) return
    const t0 = performance.now()
    const shader = (type: number, src: string) => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
    }
    const vs = shader(gl.VERTEX_SHADER, VERT)
    const fs = shader(gl.FRAGMENT_SHADER, FRAG)
    if (!vs || !fs) return
    const prog = gl.createProgram()!
    gl.attachShader(prog, vs)
    gl.attachShader(prog, fs)
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return
    ;(window as { __tpGasMs?: number }).__tpGasMs = performance.now() - t0
    gl.useProgram(prog)
    const buf = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buf)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const at = gl.getAttribLocation(prog, 'p')
    gl.enableVertexAttribArray(at)
    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0)
    for (const n of ['uRes', 'uScale', 'uTime', 'uDrift', 'uInside', 'uN', 'uG', 'uS', 'uK', 'uMid', 'uArm', 'uIon']) this.loc[n] = gl.getUniformLocation(prog, n)
    this.gl = gl
  }

  get ok(): boolean {
    return !!this.gl
  }

  /** the layer's size in CSS pixels, drawn at `scale` device pixels per CSS pixel */
  size(w: number, h: number, scale: number): void {
    if (!this.gl) return
    this.scale = scale
    this.canvas.width = Math.max(1, Math.round(w * scale))
    this.canvas.height = Math.max(1, Math.round(h * scale))
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height)
  }

  render(time: number, bodies: GasBody[], drift: number, inside: number): void {
    const gl = this.gl
    if (!gl) return
    const n = Math.min(GAS_MAX, bodies.length)
    for (let i = 0; i < n; i++) {
      const b = bodies[i]
      this.G.set([b.x, b.y, Math.max(1, b.r), b.fade], i * 4)
      this.S.set([Math.max(0.05, b.squash), b.tilt, b.rot, b.arms], i * 4)
      this.K.set([b.seed, b.spin, b.focus, 0], i * 4)
      this.mid.set(rgb(b.mid), i * 3)
      this.arm.set(rgb(b.arm), i * 3)
      this.ion.set(b.ion, i * 3)
    }
    const L = this.loc
    gl.uniform2f(L.uRes, this.canvas.width, this.canvas.height)
    gl.uniform1f(L.uScale, this.scale)
    // wrapped, so the noise keeps its precision however long the page stays open
    gl.uniform1f(L.uTime, time % 4000)
    gl.uniform2f(L.uDrift, drift, 0)
    gl.uniform1f(L.uInside, inside)
    gl.uniform1i(L.uN, n)
    gl.uniform4fv(L.uG, this.G)
    gl.uniform4fv(L.uS, this.S)
    gl.uniform4fv(L.uK, this.K)
    gl.uniform3fv(L.uMid, this.mid)
    gl.uniform3fv(L.uArm, this.arm)
    gl.uniform3fv(L.uIon, this.ion)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  dispose(): void {
    this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
    this.gl = null
  }
}
