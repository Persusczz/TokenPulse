import { app, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { muxH264 } from './mp4'

/**
 * Turns SVGs into pictures in hidden windows (Chromium draws the fonts and
 * filters): one SVG into a JPEG, or a run of SVG frames into an H.264 MP4 for
 * Telegram's animations. The windows are kept for a minute so a refresh is
 * quick.
 */
let win: BrowserWindow | null = null
let idle: NodeJS.Timeout | null = null
let ready: Promise<void> | null = null

function page(): Promise<BrowserWindow> {
  if (idle) clearTimeout(idle)
  idle = setTimeout(() => {
    win?.destroy()
    win = null
    ready = null
  }, 60_000)
  if (!win || win.isDestroyed()) {
    win = new BrowserWindow({ show: false, width: 64, height: 64, skipTaskbar: true, webPreferences: { sandbox: true, contextIsolation: true, backgroundThrottling: false } })
    ready = win.loadURL('data:text/html,<!doctype html><meta charset="utf-8"><body></body>')
  }
  const w = win
  return ready!.then(() => w)
}

export async function svgToJpeg(svg: string, width: number, height: number, quality = 0.92): Promise<Buffer> {
  const w = await page()
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  const url: string = await w.webContents.executeJavaScript(`(async () => {
    const img = new Image()
    img.src = ${JSON.stringify(src)}
    await img.decode()
    const c = document.createElement('canvas')
    c.width = ${width}
    c.height = ${height}
    c.getContext('2d').drawImage(img, 0, 0, ${width}, ${height})
    return c.toDataURL('image/jpeg', ${quality})
  })()`)
  if (!url.startsWith('data:image/jpeg;base64,')) throw new Error('卡片绘制失败')
  return Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
}

// ---------------------------------------------------------------- video

let vwin: BrowserWindow | null = null
let vidle: NodeJS.Timeout | null = null
let vready: Promise<void> | null = null

/** WebCodecs needs a secure page (a file, not data:) and frames need off-screen painting */
async function videoPage(): Promise<BrowserWindow> {
  if (vidle) clearTimeout(vidle)
  vidle = setTimeout(() => {
    vwin?.destroy()
    vwin = null
    vready = null
  }, 60_000)
  if (!vwin || vwin.isDestroyed()) {
    const file = join(app.getPath('userData'), 'render.html')
    await writeFile(file, '<!doctype html><meta charset="utf-8"><title>render</title><body></body>')
    vwin = new BrowserWindow({ show: false, width: 64, height: 64, skipTaskbar: true, webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, backgroundThrottling: false } })
    vready = vwin.loadFile(file)
  }
  const w = vwin
  return vready!.then(() => w)
}

/** runs in the page: SVG frames → H.264 samples (base64), plus the avcC record when the encoder gives one */
const ENCODE = `async (svgs, W, H, fps) => {
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s) }
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')
  const chunks = []
  let desc = null
  let failed = null
  const enc = new VideoEncoder({
    output: (chunk, meta) => {
      const u = new Uint8Array(chunk.byteLength)
      chunk.copyTo(u)
      chunks.push({ key: chunk.type === 'key', data: b64(u) })
      if (meta && meta.decoderConfig && meta.decoderConfig.description) desc = b64(new Uint8Array(meta.decoderConfig.description))
    },
    error: (e) => { failed = String(e) }
  })
  let codec = null
  for (const c of ['avc1.42E01F', 'avc1.42E028', 'avc1.4D0028']) {
    const s = await VideoEncoder.isConfigSupported({ codec: c, width: W, height: H, bitrate: 3_000_000, framerate: fps })
    if (s.supported) { codec = c; break }
  }
  if (!codec) throw new Error('no H.264 encoder')
  enc.configure({ codec, width: W, height: H, bitrate: 3_000_000, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' })
  for (let i = 0; i < svgs.length; i++) {
    const img = new Image()
    img.src = 'data:image/svg+xml;base64,' + svgs[i]
    await img.decode()
    g.drawImage(img, 0, 0, W, H)
    const f = new VideoFrame(c, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) })
    enc.encode(f, { keyFrame: i % (fps * 2) === 0 })
    f.close()
    if (failed) throw new Error(failed)
  }
  await enc.flush()
  enc.close()
  if (failed) throw new Error(failed)
  return { desc, chunks }
}`

/** SVG frames (all the same size) as a looping H.264 MP4 */
export async function svgsToMp4(svgs: string[], width: number, height: number, fps = 25): Promise<Buffer> {
  const W = width - (width % 2)
  const H = height - (height % 2)
  const w = await videoPage()
  // drawn at the video's size, not the SVG's own (much quicker to rasterise)
  const frames = svgs.map((s) => Buffer.from(s.replace(/<svg([^>]*?) width="\d+" height="\d+"/, `<svg$1 width="${W}" height="${H}"`)).toString('base64'))
  const r: { desc: string | null; chunks: { key: boolean; data: string }[] } = await w.webContents.executeJavaScript(`(${ENCODE})(${JSON.stringify(frames)}, ${W}, ${H}, ${fps})`)
  if (!r.chunks.length) throw new Error('没有编出画面')
  return muxH264({
    width: W,
    height: H,
    fps,
    avcC: r.desc ? Buffer.from(r.desc, 'base64') : null,
    samples: r.chunks.map((c) => ({ key: c.key, data: Buffer.from(c.data, 'base64') }))
  })
}

/** for checks: plays an MP4 in the hidden page and reports its size, length and a frame at `at` seconds (PNG) */
export async function probeMp4(mp4: Buffer, at = 1.5): Promise<{ width: number; height: number; duration: number; frame: Buffer }> {
  const w = await videoPage()
  const r: { width: number; height: number; duration: number; png: string } = await w.webContents.executeJavaScript(`(async () => {
    const v = document.createElement('video')
    v.muted = true
    v.src = 'data:video/mp4;base64,${mp4.toString('base64')}'
    await new Promise((ok, bad) => { v.onloadeddata = ok; v.onerror = () => bad(new Error('video error ' + (v.error && v.error.code))) })
    v.currentTime = Math.min(${at}, v.duration - 0.05)
    await new Promise((ok) => (v.onseeked = ok))
    // the seeked frame is decoded a moment after 'seeked'
    if (v.requestVideoFrameCallback) await Promise.race([new Promise((ok) => v.requestVideoFrameCallback(ok)), new Promise((ok) => setTimeout(ok, 600))])
    else await new Promise((ok) => setTimeout(ok, 300))
    const c = document.createElement('canvas')
    c.width = v.videoWidth
    c.height = v.videoHeight
    c.getContext('2d').drawImage(v, 0, 0)
    return { width: v.videoWidth, height: v.videoHeight, duration: v.duration, png: c.toDataURL('image/png').split(',')[1] }
  })()`)
  return { width: r.width, height: r.height, duration: r.duration, frame: Buffer.from(r.png, 'base64') }
}
