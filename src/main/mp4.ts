/**
 * A small MP4 writer for one H.264 video track (the Telegram animations):
 * ftyp, then moov with every sample in one chunk, then mdat. Samples are
 * length-prefixed NAL units (AVCC); Annex B input (start codes) is converted,
 * and the avcC record is built from its SPS / PPS when the encoder gave none.
 */

export interface Mp4Input {
  width: number
  height: number
  fps: number
  /** AVCDecoderConfigurationRecord; built from the first key frame when missing */
  avcC: Buffer | null
  samples: { data: Buffer; key: boolean }[]
}

function box(type: string, ...parts: Buffer[]): Buffer {
  const body = Buffer.concat(parts)
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + body.length, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, body])
}

const u8 = (n: number) => Buffer.from([n & 0xff])
const u16 = (n: number) => {
  const b = Buffer.alloc(2)
  b.writeUInt16BE(n & 0xffff)
  return b
}
const u32 = (n: number) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0)
  return b
}
const full = (version: number, flags: number) => u32(((version & 0xff) << 24) | (flags & 0xffffff))
const zeros = (n: number) => Buffer.alloc(n)
/** the identity transform */
const MATRIX = Buffer.concat([0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000].map(u32))

/** NAL units of an Annex B stream (00 00 01 / 00 00 00 01 start codes) */
export function annexB(data: Buffer): Buffer[] {
  const units: Buffer[] = []
  let start = -1
  for (let i = 0; i + 2 < data.length; i++) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      if (start >= 0) {
        // a 4-byte start code leaves a trailing zero on the previous unit
        let end = i
        if (end > start && data[end - 1] === 0) end--
        units.push(data.subarray(start, end))
      }
      start = i + 3
      i += 2
    }
  }
  if (start >= 0) units.push(data.subarray(start))
  return units.filter((u) => u.length)
}

const isAnnexB = (d: Buffer) => d.length > 4 && d[0] === 0 && d[1] === 0 && (d[2] === 1 || (d[2] === 0 && d[3] === 1))

/** length-prefixed NAL units */
function avcc(units: Buffer[]): Buffer {
  return Buffer.concat(units.flatMap((u) => [u32(u.length), u]))
}

/** the avcC record from an SPS and a PPS */
export function avcCOf(sps: Buffer, pps: Buffer): Buffer {
  return Buffer.concat([u8(1), u8(sps[1]), u8(sps[2]), u8(sps[3]), u8(0xff), u8(0xe1), u16(sps.length), sps, u8(1), u16(pps.length), pps])
}

export function muxH264(input: Mp4Input): Buffer {
  const { width, height, fps } = input
  let avcC = input.avcC
  // Annex B samples: to AVCC, keeping SPS / PPS for the avcC record
  const samples = input.samples.map((s) => {
    if (!isAnnexB(s.data)) return s
    const units = annexB(s.data)
    if (!avcC) {
      const sps = units.find((u) => (u[0] & 0x1f) === 7)
      const pps = units.find((u) => (u[0] & 0x1f) === 8)
      if (sps && pps) avcC = avcCOf(sps, pps)
    }
    return { data: avcc(units.filter((u) => ![7, 8, 9].includes(u[0] & 0x1f))), key: s.key }
  })
  if (!avcC) throw new Error('没有 H.264 参数集')

  const timescale = fps * 1000
  const delta = 1000
  const n = samples.length
  const duration = n * delta
  const ms = Math.round((n / fps) * 1000)

  const ftyp = box('ftyp', Buffer.from('isom', 'latin1'), u32(512), Buffer.from('isomiso2avc1mp41', 'latin1'))
  const mvhd = box('mvhd', full(0, 0), u32(0), u32(0), u32(1000), u32(ms), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(2))
  const tkhd = box('tkhd', full(0, 3), u32(0), u32(0), u32(1), u32(0), u32(ms), zeros(8), u16(0), u16(0), u16(0), u16(0), MATRIX, u32(width << 16), u32(height << 16))
  const mdhd = box('mdhd', full(0, 0), u32(0), u32(0), u32(timescale), u32(duration), u16(0x55c4), u16(0))
  const hdlr = box('hdlr', full(0, 0), u32(0), Buffer.from('vide', 'latin1'), zeros(12), Buffer.from('VideoHandler\0', 'latin1'))
  const vmhd = box('vmhd', full(0, 1), zeros(8))
  const dinf = box('dinf', box('dref', full(0, 0), u32(1), box('url ', full(0, 1))))
  const avc1 = box(
    'avc1',
    zeros(6),
    u16(1),
    zeros(16),
    u16(width),
    u16(height),
    u32(0x00480000),
    u32(0x00480000),
    u32(0),
    u16(1),
    zeros(32),
    u16(0x0018),
    u16(0xffff),
    box('avcC', avcC)
  )
  const stsd = box('stsd', full(0, 0), u32(1), avc1)
  const stts = box('stts', full(0, 0), u32(1), u32(n), u32(delta))
  const keys = samples.map((s, i) => (s.key ? i + 1 : 0)).filter(Boolean)
  const stss = box('stss', full(0, 0), u32(keys.length), ...keys.map(u32))
  const stsc = box('stsc', full(0, 0), u32(1), u32(1), u32(n), u32(1))
  const stsz = box('stsz', full(0, 0), u32(0), u32(n), ...samples.map((s) => u32(s.data.length)))
  // the chunk offset depends on moov's own size, which does not depend on the offset's value
  const build = (offset: number) => {
    const stco = box('stco', full(0, 0), u32(1), u32(offset))
    const stbl = box('stbl', stsd, stts, stss, stsc, stsz, stco)
    const minf = box('minf', vmhd, dinf, stbl)
    const mdia = box('mdia', mdhd, hdlr, minf)
    const trak = box('trak', tkhd, mdia)
    return box('moov', mvhd, trak)
  }
  const moovSize = build(0).length
  const moov = build(ftyp.length + moovSize + 8)
  const mdat = box('mdat', ...samples.map((s) => s.data))
  return Buffer.concat([ftyp, moov, mdat])
}
