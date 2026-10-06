import { useId, useMemo, useState } from 'react'
import type { TarotDeck } from '@shared/types'
import { ARCANA, cardStory } from '@shared/tarot'
import { cardFace } from '@shared/tarotArt'
import { cssVar, hexColor, TOOL_NAME, useApp, useData, useSource } from '../state'

const safe = (id: string) => id.replace(/[^a-zA-Z0-9]/g, '')

function Svg({ html, className }: { html: string; className?: string }) {
  return <div className={className} dangerouslySetInnerHTML={{ __html: html }} />
}

/** one card: its picture of your data in front, the numbers on the back */
function DeckCard({ id, deck, accent, money, i }: { id: number; deck: TarotDeck; accent: string; money: (v: number) => string; i: number }) {
  const uid = safe(useId())
  const [back, setBack] = useState(false)
  const a = ARCANA[id]
  const face = useMemo(() => cardFace(id, `c${uid}`, { deck, frame: accent }), [id, uid, deck, accent])
  const story = cardStory(id, deck, money)
  return (
    <div className={`deck-card${back ? ' back' : ''}`} style={{ ['--hue' as string]: a.hue, ['--i' as string]: i }}>
      <button className="deck-flip" onClick={() => setBack(!back)} aria-label={`${a.name}：${a.draws}`} title={back ? '点一下翻回牌面' : '点一下看具体数字'}>
        <span className="deck-inner">
          <Svg className="deck-face deck-front" html={face} />
          <span className="deck-face deck-back">
            <span className="deck-back-head">
              <b>{a.numeral}</b> {a.name}
            </span>
            <span className="deck-back-lines">
              {story.map((l, k) => (
                <span key={k}>{l}</span>
              ))}
            </span>
          </span>
        </span>
        <i className="deck-sheen" aria-hidden />
      </button>
      <div className="deck-caption">
        <b>
          {a.numeral} {a.name}
        </b>
      </div>
    </div>
  )
}

/**
 * 塔罗: the 22 Major Arcana, each a picture of one piece of your usage drawn
 * inside its classic scene — the Sun's rays are today's hours, the Moon's
 * phase is the week's quota, the Wheel's cells are the week's 5-hour windows.
 * The cards follow your usage as it comes in; a click turns one over to its
 * numbers.
 */
export function TarotPage() {
  const { money, lastUpdate, quota, codexQuota } = useApp()
  const source = useSource()
  const deck = useData(() => window.api.getTarot(), [source, lastUpdate?.at, quota?.fetchedAt, codexQuota?.updatedAt], 60_000)
  const accent = useMemo(() => hexColor(cssVar('--accent')) || '#d97757', [source]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">
            <span className="title-mark tarot-mark">☽</span>
            塔罗
          </h1>
          <div className="page-sub">
            22 张大阿卡纳，每张都是{source === 'all' ? '你' : ` ${TOOL_NAME[source]} `}用量的一幅画：太阳的光是今天的每个小时，月相是 7 天额度，命运之轮的格子是这周的 5 小时窗口。牌随用量实时变化，点一张翻到背面看数字
          </div>
        </div>
      </div>
      <div className="card deck-table">
        {deck ? (
          <div className="deck-grid">
            {ARCANA.map((a, i) => (
              <DeckCard key={a.id} id={a.id} deck={deck} accent={accent} money={money} i={i} />
            ))}
          </div>
        ) : (
          <div className="skeleton" style={{ height: 640 }} />
        )}
      </div>
    </>
  )
}
