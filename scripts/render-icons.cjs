// Draws the app icons (a deep-space tile with the glowing spark, and the Codex
// variant) on a canvas in a hidden Electron window, then writes PNG / ICO.
// Run: npx electron scripts/render-icons.cjs   (npm run icons)
const { app, BrowserWindow } = require('electron')
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const root = join(__dirname, '..')
const shape = JSON.parse(readFileSync(join(root, 'src/shared/starburst.json'), 'utf8'))

// runs in the page: draw(kind, size) → PNG data URL
const PAGE = `
const shape = ${JSON.stringify(shape)}
function rounded(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}
// a few fixed stars, the same in every size
const STARS = [[0.2, 0.22, 1.1], [0.79, 0.18, 0.8], [0.86, 0.4, 1.3], [0.16, 0.62, 0.7], [0.27, 0.86, 0.9], [0.72, 0.9, 0.7], [0.62, 0.12, 0.6], [0.9, 0.7, 0.9], [0.36, 0.1, 0.5]]
function tile(ctx, S, pal) {
  const small = S <= 32
  const pad = small ? S * 0.02 : S * 0.06
  const w = S - pad * 2
  const r = w * (small ? 0.24 : 0.23)
  ctx.save()
  // a soft drop shadow under the tile (large sizes only)
  if (!small) {
    ctx.shadowColor = 'rgba(0,0,0,0.45)'
    ctx.shadowBlur = S * 0.035
    ctx.shadowOffsetY = S * 0.012
  }
  rounded(ctx, pad, pad, w, w, r)
  const bg = ctx.createLinearGradient(pad, pad, pad + w, pad + w)
  bg.addColorStop(0, pal.bg0)
  bg.addColorStop(0.55, pal.bg1)
  bg.addColorStop(1, pal.bg2)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.restore()
  ctx.save()
  rounded(ctx, pad, pad, w, w, r)
  ctx.clip()
  // nebula light behind the mark, and a colder one in a corner
  let g = ctx.createRadialGradient(S * 0.5, S * 0.47, 0, S * 0.5, S * 0.47, S * 0.48)
  g.addColorStop(0, pal.glow)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  g = ctx.createRadialGradient(S * 0.86, S * 0.14, 0, S * 0.86, S * 0.14, S * 0.5)
  g.addColorStop(0, pal.nebula)
  g.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  if (S >= 64) {
    for (const [x, y, k] of STARS) {
      ctx.beginPath()
      ctx.arc(x * S, y * S, Math.max(0.6, S * 0.0045 * k), 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.35 * k / 1.3) + ')'
      ctx.fill()
    }
  }
  // glass sheen over the top half
  g = ctx.createLinearGradient(0, pad, 0, pad + w * 0.55)
  g.addColorStop(0, 'rgba(255,255,255,0.16)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, S, S)
  ctx.restore()
  // a fine rim
  rounded(ctx, pad + 0.5, pad + 0.5, w - 1, w - 1, r)
  const rim = ctx.createLinearGradient(0, pad, 0, pad + w)
  rim.addColorStop(0, 'rgba(255,255,255,' + (small ? 0.22 : 0.28) + ')')
  rim.addColorStop(1, 'rgba(255,255,255,0.04)')
  ctx.strokeStyle = rim
  ctx.lineWidth = Math.max(1, S * 0.004)
  ctx.stroke()
}
// the core and each ray as their own shapes: one combined path could cancel
// itself out where shapes of opposite winding overlap
function sparkPath(cx, cy, R, ws) {
  const core = new Path2D()
  core.arc(cx, cy, shape.core * R * ws, 0, Math.PI * 2)
  const out = [core]
  for (const ray of shape.rays) {
    const a = ((ray.a - 90) * Math.PI) / 180
    const dx = Math.cos(a), dy = Math.sin(a)
    const nx = -dy, ny = dx
    const L = ray.l * R
    const bw = shape.baseWidth * R * ws, tw = shape.tipWidth * R * ws
    const tx = cx + dx * L, ty = cy + dy * L
    const q = new Path2D()
    q.moveTo(cx + nx * bw, cy + ny * bw)
    q.lineTo(tx + nx * tw, ty + ny * tw)
    q.arc(tx, ty, tw, Math.atan2(ny, nx), Math.atan2(ny, nx) + Math.PI, true)
    q.lineTo(cx - nx * bw, cy - ny * bw)
    q.arc(cx, cy, bw, Math.atan2(-ny, -nx), Math.atan2(ny, nx), true)
    q.closePath()
    out.push(q)
  }
  return out
}
function spark(ctx, S) {
  const small = S <= 32
  const cx = S * 0.5, cy = S * (small ? 0.5 : 0.44)
  const R = S * (small ? 0.4 : 0.29)
  const ws = S <= 16 ? 1.55 : S <= 24 ? 1.4 : S <= 32 ? 1.25 : 1
  const path = sparkPath(cx, cy, R, ws)
  const fill = ctx.createRadialGradient(cx, cy, 0, cx, cy, R)
  fill.addColorStop(0, '#fff4ea')
  fill.addColorStop(0.2, '#ffc6a3')
  fill.addColorStop(0.5, '#f08f68')
  fill.addColorStop(1, '#d0653d')
  ctx.save()
  ctx.shadowColor = 'rgba(255,128,80,0.85)'
  ctx.shadowBlur = small ? S * 0.08 : S * 0.07
  ctx.fillStyle = fill
  for (const q of path) ctx.fill(q)
  ctx.restore()
  ctx.fillStyle = fill
  for (const q of path) ctx.fill(q)
  if (!small) {
    // the hot core
    const c = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.22)
    c.addColorStop(0, 'rgba(255,255,255,0.85)')
    c.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = c
    ctx.beginPath()
    ctx.arc(cx, cy, R * 0.22, 0, Math.PI * 2)
    ctx.fill()
  }
}
// the pulse: a heartbeat trace under the spark
function pulse(ctx, S, color) {
  const y = S * 0.845
  const x0 = S * 0.2, x1 = S * 0.8
  const u = (x1 - x0) / 20
  const pts = [[0, 0], [7, 0], [8, -0.5], [9, 0.4], [10, -1.7], [11, 1.2], [12, 0], [13, -0.3], [14, 0], [20, 0]]
  ctx.save()
  const g = ctx.createLinearGradient(x0, 0, x1, 0)
  g.addColorStop(0, 'rgba(255,255,255,0)')
  g.addColorStop(0.3, color)
  g.addColorStop(0.7, color)
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.strokeStyle = g
  ctx.lineWidth = Math.max(1.2, S * 0.016)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.shadowColor = color
  ctx.shadowBlur = S * 0.02
  ctx.beginPath()
  pts.forEach(([a, b], i) => (i ? ctx.lineTo(x0 + a * u, y + b * u) : ctx.moveTo(x0 + a * u, y + b * u)))
  ctx.stroke()
  ctx.restore()
}
// Codex: a terminal prompt
function prompt(ctx, S) {
  const small = S <= 32
  const k = small ? 1.18 : 1
  const cx = S * 0.5, cy = S * (small ? 0.5 : 0.47)
  const g = ctx.createLinearGradient(cx - S * 0.25, cy - S * 0.2, cx + S * 0.25, cy + S * 0.2)
  g.addColorStop(0, '#eef0ff')
  g.addColorStop(0.5, '#a7b2ff')
  g.addColorStop(1, '#6d7cff')
  ctx.save()
  ctx.strokeStyle = g
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = S * (small ? 0.11 : 0.075)
  ctx.shadowColor = 'rgba(110,126,255,0.95)'
  ctx.shadowBlur = S * 0.07
  for (let pass = 0; pass < 2; pass++) {
    ctx.beginPath()
    ctx.moveTo(cx - S * 0.22 * k, cy - S * 0.16 * k)
    ctx.lineTo(cx - S * 0.05 * k, cy)
    ctx.lineTo(cx - S * 0.22 * k, cy + S * 0.16 * k)
    ctx.moveTo(cx + S * 0.03 * k, cy + S * 0.17 * k)
    ctx.lineTo(cx + S * 0.23 * k, cy + S * 0.17 * k)
    ctx.stroke()
    ctx.shadowBlur = 0
  }
  ctx.restore()
}
const PAL = {
  claude: { bg0: '#3b2140', bg1: '#191230', bg2: '#080a18', glow: 'rgba(232,124,84,0.42)', nebula: 'rgba(132,96,255,0.28)' },
  codex: { bg0: '#262c6e', bg1: '#121539', bg2: '#060818', glow: 'rgba(98,112,255,0.45)', nebula: 'rgba(80,200,255,0.22)' }
}
window.draw = (kind, S) => {
  const c = document.createElement('canvas')
  c.width = c.height = S
  const ctx = c.getContext('2d')
  tile(ctx, S, PAL[kind])
  if (kind === 'claude') {
    spark(ctx, S)
    if (S >= 48) pulse(ctx, S, '#ffc6a8')
  } else {
    prompt(ctx, S)
    if (S >= 48) pulse(ctx, S, '#b9c2ff')
  }
  return c.toDataURL('image/png')
}
`

function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  let offset = header.length
  images.forEach(({ size, data }, i) => {
    const e = 6 + i * 16
    header[e] = size >= 256 ? 0 : size
    header[e + 1] = size >= 256 ? 0 : size
    header.writeUInt16LE(1, e + 4)
    header.writeUInt16LE(32, e + 6)
    header.writeUInt32LE(data.length, e + 8)
    header.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, ...images.map((i) => i.data)])
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } })
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><script>${PAGE}</script>`))
  const render = async (kind, size) => {
    const url = await win.webContents.executeJavaScript(`draw(${JSON.stringify(kind)}, ${size})`)
    return Buffer.from(url.split(',')[1], 'base64')
  }
  mkdirSync(join(root, 'resources'), { recursive: true })
  mkdirSync(join(root, 'build'), { recursive: true })
  writeFileSync(join(root, 'resources/icon.png'), await render('claude', 256))
  writeFileSync(join(root, 'resources/icon-codex.png'), await render('codex', 256))
  writeFileSync(join(root, 'build/icon.png'), await render('claude', 512))
  const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
  const images = []
  for (const s of sizes) images.push({ size: s, data: await render('claude', s) })
  writeFileSync(join(root, 'build/icon.ico'), ico(images))
  // a contact sheet for checking the small sizes by eye
  const out = process.env.TP_ICON_SHEET
  if (out) for (const s of [16, 24, 32, 48, 256]) for (const k of ['claude', 'codex']) writeFileSync(join(out, `${k}-${s}.png`), await render(k, s))
  console.log('app icons written')
  app.quit()
})
