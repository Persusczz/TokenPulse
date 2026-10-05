import { fmtTokens } from '@shared/format'
import type { Intensity } from '@shared/types'
import { Backdrop } from '../components/Backdrop'
import { Starburst } from '../components/Starburst'
import { useApp, useData } from '../state'

/** Live desktop wallpaper: the backdrop, plus a quiet corner readout */
export function Wallpaper({ theme, paint }: { theme: string; paint: string }) {
  const { quota, lastUpdate } = useApp()
  const live = useData(() => window.api.getLive(), [], 15_000)
  const five = quota?.windows.find((w) => w.key === 'session' || w.key === 'five_hour')
  return (
    <div className="wallpaper">
      <Backdrop theme={theme} paint={paint} animated />
      <div className="wall-corner">
        <Starburst size={22} intensity={(live?.intensity ?? 0) as Intensity} pulse={lastUpdate?.addedTokens ? lastUpdate.at : 0} />
        <span>今日 {fmtTokens(live?.today.tokens ?? 0, 1)}</span>
        {five && <span>5h {Math.round(five.utilization)}%</span>}
      </div>
    </div>
  )
}
