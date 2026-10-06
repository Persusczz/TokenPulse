import { describe, expect, it } from 'vitest'
import { annexB, avcCOf, muxH264 } from '../src/main/mp4'

/** top-level boxes of an MP4: type, offset, size */
function boxes(b: Buffer, from = 0, to = b.length): { type: string; at: number; size: number }[] {
  const out: { type: string; at: number; size: number }[] = []
  for (let at = from; at + 8 <= to; ) {
    const size = b.readUInt32BE(at)
    out.push({ type: b.toString('latin1', at + 4, at + 8), at, size })
    if (size < 8) break
    at += size
  }
  return out
}

const find = (b: Buffer, type: string) => b.indexOf(Buffer.from(type, 'latin1'))

describe('mp4: one H.264 track', () => {
  const sps = Buffer.from([0x67, 0x42, 0xe0, 0x1f, 0xaa])
  const pps = Buffer.from([0x68, 0xce, 0x3c, 0x80])
  const idr = Buffer.from([0x65, 1, 2, 3, 4])
  const p = Buffer.from([0x41, 9, 9])
  const start = Buffer.from([0, 0, 0, 1])

  it('splits Annex B into NAL units', () => {
    expect(annexB(Buffer.concat([start, sps, start, pps, Buffer.from([0, 0, 1]), idr]))).toEqual([sps, pps, idr])
  })

  it('writes ftyp, moov and mdat, with the chunk offset on the first sample', () => {
    const avcC = avcCOf(sps, pps)
    const samples = [
      { key: true, data: Buffer.concat([Buffer.from([0, 0, 0, 5]), idr]) },
      { key: false, data: Buffer.concat([Buffer.from([0, 0, 0, 3]), p]) }
    ]
    const mp4 = muxH264({ width: 720, height: 420, fps: 20, avcC, samples })
    const top = boxes(mp4)
    expect(top.map((x) => x.type)).toEqual(['ftyp', 'moov', 'mdat'])
    expect(top.reduce((a, x) => a + x.size, 0)).toBe(mp4.length)
    const stco = find(mp4, 'stco')
    const offset = mp4.readUInt32BE(stco + 12)
    expect(offset).toBe(top[2].at + 8)
    expect(mp4.subarray(offset, offset + samples[0].data.length)).toEqual(samples[0].data)
    // sizes, sync samples, and the 1 s 100 ms length (2 frames at 20 fps = 0.1 s)
    const stsz = find(mp4, 'stsz')
    expect([mp4.readUInt32BE(stsz + 12), mp4.readUInt32BE(stsz + 16), mp4.readUInt32BE(stsz + 20)]).toEqual([2, 9, 7])
    const stss = find(mp4, 'stss')
    expect([mp4.readUInt32BE(stss + 8), mp4.readUInt32BE(stss + 12)]).toEqual([1, 1])
    const mvhd = find(mp4, 'mvhd')
    expect(mp4.readUInt32BE(mvhd + 20)).toBe(100)
    expect(mp4.subarray(find(mp4, 'avcC') + 4, find(mp4, 'avcC') + 4 + avcC.length)).toEqual(avcC)
  })

  it('builds avcC from the parameter sets when the samples are Annex B', () => {
    const mp4 = muxH264({ width: 64, height: 64, fps: 25, avcC: null, samples: [{ key: true, data: Buffer.concat([start, sps, start, pps, start, idr]) }] })
    const at = find(mp4, 'avcC')
    expect(mp4.subarray(at + 4, at + 4 + avcCOf(sps, pps).length)).toEqual(avcCOf(sps, pps))
    // the sample keeps only the picture, length-prefixed
    const stco = find(mp4, 'stco')
    const offset = mp4.readUInt32BE(stco + 12)
    expect(mp4.subarray(offset)).toEqual(Buffer.concat([Buffer.from([0, 0, 0, 5]), idr]))
    expect(() => muxH264({ width: 64, height: 64, fps: 25, avcC: null, samples: [{ key: true, data: Buffer.concat([start, idr]) }] })).toThrow()
  })
})
