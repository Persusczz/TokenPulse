// Rasterizes the starburst (src/shared/starburst.json) into the tray icons.
// Pure Node: no image libraries needed. The app icons come from
// render-icons.cjs (gradients and glow need a real canvas).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const shape = JSON.parse(readFileSync(join(root, 'src/shared/starburst.json'), 'utf8'))
const hex = shape.color.replace('#', '')
const [R, G, B] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))

const rays = shape.rays.map(({ a, l }) => {
  const rad = ((a - 90) * Math.PI) / 180
  return { dx: Math.cos(rad), dy: Math.sin(rad), l }
})

function inside(x, y, widthScale) {
  if (x * x + y * y <= (shape.core * widthScale) ** 2) return true
  for (const r of rays) {
    const t = Math.max(0, Math.min(1, (x * r.dx + y * r.dy) / r.l))
    const px = r.dx * r.l * t
    const py = r.dy * r.l * t
    const w = (shape.baseWidth * (1 - t) + shape.tipWidth * t) * widthScale
    if ((x - px) ** 2 + (y - py) ** 2 <= w * w) return true
  }
  return false
}

function render(size, { widthScale = 1, pad = 0.1 } = {}) {
  const ss = 5
  const px = Buffer.alloc(size * size * 4)
  const span = 2 * (1 + pad)
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let hit = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const x = ((i + (sx + 0.5) / ss) / size) * span - span / 2
          const y = ((j + (sy + 0.5) / ss) / size) * span - span / 2
          if (inside(x, y, widthScale)) hit++
        }
      }
      const o = (j * size + i) * 4
      px[o] = R
      px[o + 1] = G
      px[o + 2] = B
      px[o + 3] = Math.round((hit / (ss * ss)) * 255)
    }
  }
  return png(size, px)
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}
const small = (s) => ({ widthScale: s <= 16 ? 1.5 : s <= 32 ? 1.3 : 1 })
mkdirSync(join(root, 'resources'), { recursive: true })
writeFileSync(join(root, 'resources/tray.png'), render(16, small(16)))
writeFileSync(join(root, 'resources/tray@2x.png'), render(32, small(32)))
console.log('tray icons written')
