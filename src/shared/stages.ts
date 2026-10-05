import type { StarStage } from './types'

/** A 5-hour window as a star's life, by how much of it is used (percent) */
export const STAGES: { key: StarStage; name: string; from: number; desc: string; color: string }[] = [
  { key: 'nebula', name: '星云', from: 0, desc: '额度刚刷新，气体云还在慢慢聚拢', color: '#9fb4ff' },
  { key: 'protostar', name: '原恒星', from: 10, desc: '核心开始发热，一颗恒星正在成形', color: '#ffc58a' },
  { key: 'main', name: '主序星', from: 35, desc: '稳定燃烧，像现在的太阳', color: '#ffe27a' },
  { key: 'giant', name: '红巨星', from: 70, desc: '燃料过半，恒星膨胀、变红', color: '#ff8a5c' },
  { key: 'supergiant', name: '超巨星', from: 90, desc: '极不稳定，随时可能爆发', color: '#ff4f6d' },
  { key: 'supernova', name: '超新星', from: 100, desc: '额度用尽：恒星爆发了，刷新后从星云重生', color: '#ffffff' }
]

export function stageOf(pct: number): StarStage {
  let s: StarStage = 'nebula'
  for (const st of STAGES) if (pct >= st.from) s = st.key
  return s
}

export const stageInfo = (pct: number) => STAGES.find((s) => s.key === stageOf(pct))!
