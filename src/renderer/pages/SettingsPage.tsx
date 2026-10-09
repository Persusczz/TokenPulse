import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'
import { ACCENT_KEYS, ACCENTS, type AccentKey } from '@shared/accents'
import { toCurrency } from '@shared/format'
import { HOTKEYS, hotkeyLabel, type Hotkey, type HotkeyStatus } from '@shared/hotkeys'
import { PACK_KEYS, PACKS } from '@shared/packs'
import type { BackdropStyle, CodexUsageState, FrameCap, MiniMode, MotionLevel, QuotaSource, Settings, SourceView, TaskPermission, TaskQueueState, ThemePack, ThemeSetting, WindowMaterial } from '@shared/types'
import { CompactPicker } from '../components/CompactPicker'
import { ScenePreview, useLivePreview } from '../components/ScenePreview'
import { IconClose } from '../components/Icons'
import { APP_ICON, openUpdateDialog } from '../components/UpdateDialog'
import { RESET_LANGS } from '../components/ResetWatch'
import { Segmented } from '../components/Segmented'
import { CITIES, placeOf, sunTimes, type Place } from '@shared/astro'
import { applyPack } from '../components/CommandPalette'
import { revealFromPointer } from '../effects'
import { resolveTheme, useApp, useData, useSource, useUpdate } from '../state'
import { WORKBUDDY_PLANS_URL } from '../../features/workbuddy/links'

function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={`switch${on ? ' on' : ''}`} role="switch" aria-checked={on} onClick={() => onChange(!on)} />
}

function Row({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div>
        <div className="set-label">{label}</div>
        {desc && <div className="set-desc">{desc}</div>}
      </div>
      <div className="set-ctl">{children}</div>
    </div>
  )
}

/** Budget field edited in the display currency, stored in USD */
function BudgetInput({ usd, onSave }: { usd: number | null; onSave: (usd: number | null) => void }) {
  const { moneyOpts } = useApp()
  const show = (v: number | null) => (v === null ? '' : String(Math.round(toCurrency(v, moneyOpts) * 100) / 100))
  const [text, setText] = useState(show(usd))
  useEffect(() => setText(show(usd)), [usd, moneyOpts.currency, moneyOpts.cnyRate]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const n = Number(text)
    if (!text.trim() || !Number.isFinite(n) || n <= 0) return onSave(null)
    onSave(moneyOpts.currency === 'CNY' ? n / moneyOpts.cnyRate : n)
  }
  return (
    <div className="money-input">
      <span className="muted">{moneyOpts.currency === 'CNY' ? '¥' : '$'}</span>
      <input
        className="input tnum"
        inputMode="decimal"
        placeholder="不限"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </div>
  )
}

/** A percentage slider that saves when released */
function PercentSlider({ value, min, max, onSave }: { value: number; min: number; max: number; onSave: (v: number) => void }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <>
      <input type="range" min={min} max={max} value={v} className="slider" onChange={(e) => setV(Number(e.target.value))} onMouseUp={() => onSave(v)} onKeyUp={() => onSave(v)} />
      <span className="tnum muted" style={{ width: 40, textAlign: 'right' }}>
        {v}%
      </span>
    </>
  )
}

const SOURCES: { value: QuotaSource; label: string; desc: string }[] = [
  { value: 'auto', label: '自动', desc: '用量接口为主，状态栏桥接有更新的数据时优先用它；都不可用时退回本地估算' },
  { value: 'oauth', label: '用量接口', desc: 'Claude Code /usage 使用的 Anthropic 接口：数据最全（含 Opus/Sonnet 周额度与构成），但未公开文档，需要本机登录令牌有效' },
  { value: 'statusline', label: '官方状态栏', desc: 'Claude Code 官方文档提供给状态栏脚本的 rate_limits：稳定、无需令牌、每次响应后更新；只有 5h / 7 天两项，需开启下方的状态栏桥接' },
  { value: 'local', label: '本地估算', desc: '只看本机日志：本 5h 窗口的等价 API 费用 ÷ 窗口上限（自动用官方数据校准，或手动填写）。离线可用，但只是估算' }
]
const MOTIONS: { value: MotionLevel; label: string; desc: string }[] = [
  { value: 'off', label: '关闭', desc: '不播放装饰动画，数字直接跳到新值（系统开启「减少动态效果」时也是这样）' },
  { value: 'subtle', label: '柔和', desc: '保留过渡和少量水滴，适合长时间挂着' },
  { value: 'standard', label: '标准', desc: '滴管水滴、涟漪、点击火花、心电图、流光边框、卡片光斑和入场动画' },
  { value: 'rich', label: '华丽', desc: '在标准之上更多水滴与火花，背景流得更快，卡片随鼠标 3D 倾斜' }
]
const FRAME_CAPS: { value: FrameCap; label: string; desc: string }[] = [
  { value: 'auto', label: '自动', desc: '每种动画按它自己的节奏（背景场景约 30 帧，仪表约 60 帧），按屏幕刷新等间隔出帧，最稳' },
  { value: '30', label: '30 帧', desc: '所有动画最多 30 帧，最省电，适合笔记本用电池时' },
  { value: '60', label: '60 帧', desc: '所有动画（包括背景场景）都按约 60 帧，更顺滑，耗电稍多' },
  { value: 'max', label: '不限', desc: '跟随屏幕刷新率（高刷屏上最顺滑，也最耗电）' }
]
/** backdrops, grouped in the picker by `cat` */
export const BACKDROPS: { value: BackdropStyle; label: string; desc: string; cat: string }[] = [
  { value: 'plain', label: '纯色', cat: '简约', desc: '只用主题底色' },
  { value: 'flow', label: '流光', cat: '简约', desc: '持续流动的彩色光雾（GPU 绘制）：用量越火热流得越快，每批新用量都会荡开一圈光波' },
  { value: 'aurora', label: '极光', cat: '简约', desc: '柔和流动的色块，在卡片之间若隐若现' },
  { value: 'ripples', label: '涟漪', cat: '简约', desc: '平静水面上不时泛起涟漪：用量越密涟漪越多，每批新用量都会从上方滴落一滴' },
  { value: 'paper', label: '纸笺', cat: '简约', desc: '带纤维的暖色纸和点阵格、页边红线，窗外的阳光慢慢移过纸面，角落一圈咖啡渍；每批新用量用铅笔在页边画一个小涂鸦（折线、星星、对勾、螺旋……），慢慢淡去' },
  {
    value: 'claude',
    label: 'Claude 暖光',
    cat: '品牌',
    desc: '陶土、琥珀和鼠尾草绿的柔和色块缓缓漂移，手绘线条和小星芒点缀；侧边栏空处是 Claude Code 的招牌：会变形的星芒和一个古怪的动词（Clauding… Pondering…），跟着真实用量计时、计 Token，停下后显示这一段用了多久'
  },
  {
    value: 'codex',
    label: 'Codex 夜终端',
    cat: '品牌',
    desc: '点阵底色、顶上漂移的蓝紫光和若隐若现的节点网络；侧边栏空处是 Codex 的提示符方块和闪着微光的「Working」状态行，跟着真实用量计时'
  },
  {
    value: 'galaxy',
    label: '宇宙',
    cat: '天体',
    desc: '深空和横贯窗口的银河里，几千颗星组成的旋涡星系缓缓旋转；侧边栏里一个带吸积盘的黑洞，角落升起一颗带环巨行星，还有创生之柱和上帝之眼两片星云，彗星和流星不时划过。每批新用量点亮星系核心、下一场流星雨，今日 Token 过里程碑时爆发一颗超新星（华丽档下随鼠标视差）。深色主题下最壮观'
  },
  { value: 'stars', label: '星河', cat: '天体', desc: '光点组成的星河顺着暗流漂移、相近时连成星座；每批新用量从星芒处喷涌出一团星光，再汇入星河（华丽档下鼠标能拨开星星）' },
  {
    value: 'astral',
    label: '星图',
    cat: '天体',
    desc: '天球网格和十二星座环缓缓转动，今天的星座画在正中：今天的用量每到平日的一部分就点亮一颗星，全部点亮说明今天已经超过平时；新用量划过流星'
  },
  {
    value: 'orrery',
    label: '行星仪',
    cat: '天体',
    desc: '黄铜色的太阳系仪：八大行星停在它们今天真实所在的位置（按 JPL 轨道根数计算），黄铜臂连着太阳，光沿轨道流动，小行星带缓缓转动；每批新用量从地球发射一枚探测器飞向外行星'
  },
  { value: 'lunar', label: '月夜', cat: '天体', desc: '海上的夜：天上是今晚真实的月相，银色的月光路在海面上闪烁，薄云飘过时被月光照亮边缘，远处灯塔的光束来回扫过；新用量划过流星，月光路上荡起一道亮波' },
  { value: 'eclipse', label: '日冕', cat: '天体', desc: '日全食的一刻：黑色月轮外珍珠白的日冕丝缕缓缓闪动，边缘跳着粉红的日珥，地平线一圈都是晚霞，金星就在旁边；每批新用量闪出一枚钻石环' },
  { value: 'trails', label: '星轨', cat: '天体', desc: '长曝光的夜空：星星绕着天极画出彩色的同心圆弧，天空一直在转；山脊上一顶亮着灯的帐篷，流星不时划过，新用量来一颗留下余迹的火流星' },
  {
    value: 'daylight',
    label: '昼夜',
    cat: '自然',
    desc: '山湖的一整天，按你所在城市真实的太阳和节气变化：晨雾、热气球、航迹、盘旋的鹰、帆船、过云雨和彩虹、晚霞、蝙蝠、星河、卫星、萤火，四季各有飘落的花絮叶雪，远山冬天积雪、秋天染红。新用量白天惊起一群飞鸟、夜里划过一颗流星；用量越大风越大、松树摇得越厉害，深夜用量火热时拉起极光；今日 Token 过里程碑白天挂起彩虹'
  },
  {
    value: 'sakura',
    label: '樱花',
    cat: '自然',
    desc: '樱花枝从顶部两角伸进来，花瓣翻转着飘落，偶尔一阵风；用量越多花瓣越多，每批新用量从枝头摇下一阵花雨（深色模式是月下夜樱）'
  },
  {
    value: 'dune',
    label: '沙丘',
    cat: '自然',
    desc: '黄昏的沙丘层层叠叠，脊线被低垂的太阳照亮，风把细沙从脊上吹起；用量越多风越大，每批新用量卷起一阵风沙（深色模式是沙漠星夜）'
  },
  { value: 'rain', label: '雨夜', cat: '自然', desc: '雨夜的窗：玻璃外是失焦的城市灯光，水珠在玻璃上凝结、汇合，一顿一顿地滑落，擦出一道道水痕；用量越多雨越大，新用量远处亮起一道闪电' },
  { value: 'firefly', label: '萤火', cat: '自然', desc: '夏夜的林间：层层树影和低低的雾，萤火虫一明一暗地游荡，倒映在水面；用量越多萤火越多，新用量从草丛里飞起一群（浅色模式是黄昏的金色光尘）' },
  { value: 'borealis', label: '北极光', cat: '自然', desc: '极夜雪山上空，三道绿紫光幕不停折叠摇曳；每批新用量沿光幕荡过一道亮波' },
  { value: 'abyss', label: '深海', cat: '自然', desc: '海面透下的光束、下沉的海雪、发光的浮游生物和水母，气泡随用量上浮；新用量时涌起一串气泡' },
  { value: 'ink', label: '水墨', cat: '自然', desc: '宣纸上层叠的水墨远山、朱日、飞鸟和缓缓流动的雾；每批新用量像一滴墨落在纸上晕开' },
  { value: 'lava', label: '熔岩灯', cat: '奇想', desc: '复古熔岩灯：蜡团在暖紫底色里升起、冷却、下沉、彼此融合；用量越多越热、动得越快，每批新用量从灯底涌起一大团' },
  { value: 'crystal', label: '冰晶', cat: '奇想', desc: '低多边形的冰面，一片片晶面随转动的光明暗变化，偶尔折出彩虹；用量越多光转得越快，每批新用量荡开一圈光' },
  { value: 'matrix', label: '数字雨', cat: '奇想', desc: '绿色代码雨：一列列字符落下，头部发亮、尾巴渐暗；用量越多雨越密越快，每批新用量点亮一片从天而降的亮列' },
  { value: 'bauhaus', label: '包豪斯', cat: '奇想', desc: '米色纸上红蓝黄黑的几何块组成网格，时不时咔哒转上四分之一圈；用量越多转得越勤，新用量让几块弹一下（深色模式是炭灰底）' },
  { value: 'fireworks', label: '烟花', cat: '节庆', desc: '城市夜空放烟花：礼花升空、绽放、拖着光尾落下；用量越多放得越勤，每批新用量放一发，Token 越多烟花越大' },
  { value: 'lantern', label: '天灯', cat: '节庆', desc: '湖面上空的孔明灯摇晃着升起，火苗闪动、倒影落在水里；用量越多灯越多，每批新用量从岸边放飞几盏（浅色模式是黄昏）' },
  {
    value: 'mystic',
    label: '诡秘世界',
    cat: '幻境',
    desc: '绯红之月下的雾都：封印法阵绕着月亮转动，灰雾层层漫过街巷，煤气灯明灭，塔罗牌浮起翻面，渡鸦掠过；侧边栏的钟楼走着真实时间、整点敲钟。用量越多雾越浓，每批新用量翻开一张金光塔罗牌、钟声响起'
  },
  {
    value: 'cyber',
    label: '赛博朋克',
    cat: '幻境',
    desc: '雨夜的不夜城：摩天楼窗格明灭，竖排霓虹招牌挂在侧边栏，探照灯扫过雾霾，飞行车拖着光轨（用量越多车越多），全息广告牌转着线框体；每批新用量广告牌故障闪烁、打出这批 Token，巡逻车呼啸而过'
  },
  {
    value: 'xianxia',
    label: '云海仙山',
    cat: '幻境',
    desc: '皓月下的云海与浮空石峰，侧边栏一座带亭子和飞瀑的浮岛，仙鹤从月前飞过、灵光上升；用量越多云走得越快，每批新用量划过一道御剑剑光'
  },
  {
    value: 'koi',
    label: '锦鲤池',
    cat: '自然',
    desc: '俯瞰锦鲤池：八种锦鲤摆尾游动，水底光纹流动，睡莲荷花漂移、花瓣浮在水面，偶尔落雨点出涟漪；每批新用量撒一把鱼食、锦鲤争食，大批量时游来一条金色锦鲤（浅色模式是午后的碧水）'
  },
  {
    value: 'ukiyo',
    label: '浮世绘',
    cat: '奇想',
    desc: '木版画的海：普鲁士蓝的天顶、红日、霞带和雪山，浪头翻着白沫、小船起伏、千鸟飞过；侧边栏的巨浪涨起、卷爪、拍碎，周而复始。用量越多浪越高，新用量甩出一片浪花（深色模式是夜版画）'
  },
  {
    value: 'pixel',
    label: '像素冒险',
    cat: '奇想',
    desc: '8-bit 视差世界，天色随时辰变；标题旁的砖块浮岛上，小冒险家在金币间跑跳，用量越多跑得越快；每批新用量顶开问号砖，蹦出金币和像素数字写的 Token 数'
  },
  { value: 'neon', label: '霓虹', cat: '自然', desc: '合成器浪潮的夜：条纹落日沉进霓虹地平线，线框山脉前一张网格向你奔来（用量越火热越快），每批新用量沿网格扫过一道光' }
]
const BACKDROP_CATS = ['天体', '幻境', '自然', '节庆', '奇想', '品牌', '简约']
const MATERIALS: { value: WindowMaterial; label: string; desc: string }[] = [
  { value: 'none', label: '无', desc: '不透明窗口' },
  { value: 'mica', label: '云母', desc: 'Windows 11 云母材质：窗口底色随桌面壁纸变化（需要 Windows 11 22H2 及以上）' },
  { value: 'acrylic', label: '亚克力', desc: 'Windows 11 亚克力材质：半透明磨砂，透出窗口后面的内容（需要 Windows 11 22H2 及以上）' }
]
const MINI_MODES: { value: MiniMode; label: string }[] = [
  { value: 'card', label: '卡片' },
  { value: 'capsule', label: '胶囊' },
  { value: 'orb', label: '水球' }
]
const MINI_SCALES = [
  { value: '0.85', label: '小' },
  { value: '1', label: '中' },
  { value: '1.25', label: '大' },
  { value: '1.5', label: '特大' }
]
const MINI_DESC: Record<MiniMode, string> = {
  card: '今日用量、速率、费用，底部轮播 5h / 7 天额度、消耗速度和守卫状态',
  capsule: '一条细长胶囊：今日 Token、5h 额度环和速率，占地最小',
  orb: '圆形水球：水位是 5h 额度（没有额度数据时是今日预算），新用量会从滴管滴进去'
}
const TASK_PERMISSIONS: { value: TaskPermission; label: string }[] = [
  { value: 'inherit', label: '跟随 Claude Code 设置' },
  { value: 'auto', label: '自动判断（auto）' },
  { value: 'acceptEdits', label: '允许改文件' },
  { value: 'bypassPermissions', label: '完全放行' },
  { value: 'plan', label: '只做规划' }
]
/** the same choices in Codex's terms (its sandbox modes) */
export const CODEX_PERMISSIONS: { value: TaskPermission; label: string; desc: string }[] = [
  { value: 'inherit', label: '跟随 Codex 设置', desc: '使用 ~/.codex/config.toml 里的沙箱设置' },
  { value: 'plan', label: '只读', desc: '沙箱 read-only：只能读文件和运行只读命令' },
  { value: 'acceptEdits', label: '可写工作区', desc: '沙箱 workspace-write：可以改工作目录里的文件' },
  { value: 'bypassPermissions', label: '完全放行', desc: '跳过沙箱和所有确认，适合信任的仓库' }
]
/** the button row under Telegram's input box */
const TG_KEYBOARDS: { value: Settings['telegramKeyboard']; label: string; desc: string }[] = [
  { value: 'fold', label: '点完收起', desc: '只有一行按钮，点一下就自动收起，点输入框旁的 ⌨️ 再展开' },
  { value: 'keep', label: '常驻可收', desc: '一行按钮一直在，点输入框旁的 ⌨️ 随时收起' },
  { value: 'off', label: '不要按钮', desc: '用左下角「菜单」和 /panel 控制面板' }
]

const THEMES: { value: ThemeSetting; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' }
]

type Save = (p: Partial<Settings>) => void

// ---------------------------------------------------------------- groups

function AppearanceRows({ s, save }: { s: Settings; save: Save }) {
  const motion = MOTIONS.find((m) => m.value === s.motion)!
  const material = MATERIALS.find((m) => m.value === s.windowMaterial)!
  // the new theme (or accent) grows as a circle from the click
  const setTheme = (theme: ThemeSetting) =>
    revealFromPointer(() => {
      document.documentElement.dataset.theme = resolveTheme(theme)
      save({ theme })
    })
  const setAccent = (accent: AccentKey) =>
    revealFromPointer(() => {
      document.documentElement.dataset.accent = accent
      save({ accent })
    })
  // a pack swaps colours, backdrop, theme and fonts in one go, revealed from the click
  const setPack = (k: ThemePack) => revealFromPointer(() => applyPack(k, save))
  return (
    <>
      <Fold
        id="packs"
        label="主题包"
        current={PACKS[s.themePack].label}
        desc={`${PACKS[s.themePack].desc}。一键换掉整套配色、背景和字体，每个主题有自己的入场和翻页动效`}
        count={PACK_KEYS.length}
        preview={<PackPreview k={s.themePack} />}
      >
        <div className="packs" role="radiogroup">
          {PACK_KEYS.map((k) => (
            <PackCard key={k} k={k} on={s.themePack === k} onPick={() => setPack(k)} />
          ))}
        </div>
      </Fold>
      <Row label="主题" desc={s.themePack !== 'none' ? `配色来自主题包「${PACKS[s.themePack].label}」，选「Claude 默认」可换回` : '浅色与深色均按 Claude 配色'}>
        <Segmented value={s.theme} onChange={setTheme} options={THEMES} />
      </Row>
      <Row
        label="主题色"
        desc={`${ACCENTS[s.accent].label} · 按钮、星芒、图表高亮、背景配色都会跟着换${s.sourceFilter === 'codex' ? '（只看 Codex 时用 Codex 自己的蓝紫色）' : ''}`}
      >
        <div className="accents" role="radiogroup">
          {ACCENT_KEYS.map((k) => (
            <button
              key={k}
              role="radio"
              aria-checked={s.accent === k}
              title={ACCENTS[k].label}
              className={`accent-dot${s.accent === k ? ' on' : ''}`}
              style={{ ['--c' as string]: ACCENTS[k].hex }}
              onClick={() => setAccent(k)}
            />
          ))}
        </div>
      </Row>
      <Row label="动效强度" desc={motion.desc}>
        <Segmented value={s.motion} onChange={(m) => save({ motion: m })} options={MOTIONS} />
      </Row>
      <Row label="动画帧率" desc={FRAME_CAPS.find((c) => c.value === s.frameCap)!.desc}>
        <Segmented value={s.frameCap} onChange={(frameCap) => save({ frameCap })} options={FRAME_CAPS} />
      </Row>
      <Row label="帧率显示" desc="主窗口右下角显示实时帧率和最慢的帧，方便看动画是否流畅">
        <Switch on={s.fpsMeter} onChange={(fpsMeter) => save({ fpsMeter })} />
      </Row>
      <BackdropPicker s={s} save={save} />
      <Row label="背景鲜明度" desc="背景色彩的浓淡，20–100%">
        <PercentSlider value={Math.round(s.backdropVivid * 100)} min={20} max={100} onSave={(v) => save({ backdropVivid: v / 100 })} />
      </Row>
      <Row label="玻璃卡片" desc="卡片变成半透明磨砂玻璃，背景透过整个界面（纯色背景时不生效）">
        <Switch on={s.glassCards} onChange={(glassCards) => save({ glassCards })} />
      </Row>
      <Row
        label="光影特效"
        desc="从标志洒下的光束、跟随鼠标的柔光；新用量到来时一道光从计数器扫过所有卡片，大批量时星芒闪出镜头光晕；解锁成就时全屏迸发光芒（动效关闭时不播放）"
      >
        <Switch on={s.lightFx} onChange={(lightFx) => save({ lightFx })} />
      </Row>
      <DayNightRows s={s} save={save} />
      <Row label="背景自适应" desc="背景色调随时间变化（清晨、白天、黄昏、夜晚），用量越火热越明亮，5h 额度超过 70% 后逐渐转红">
        <Switch on={s.adaptiveBackdrop} onChange={(adaptiveBackdrop) => save({ adaptiveBackdrop })} />
      </Row>
      <Row label="窗口材质" desc={material.desc}>
        <Segmented value={s.windowMaterial} onChange={(m) => save({ windowMaterial: m })} options={MATERIALS} />
      </Row>
    </>
  )
}

/** one pack: its preview plays the pack's own scene while the pointer rests on it */
function PackCard({ k, on, onPick }: { k: ThemePack; on: boolean; onPick: () => void }) {
  const p = PACKS[k]
  const live = useLivePreview()
  return (
    <button role="radio" aria-checked={on} className={`pack pack-${k}${on ? ' on' : ''}${live.on ? ' previewing' : ''}`} onClick={onPick} title={p.desc} {...live.bind}>
      <PackPreview k={k} live={live.on} />
      <span className="pack-name">{p.label}</span>
      <span className="pack-desc">{p.desc}</span>
    </button>
  )
}

function PackPreview({ k, live = false }: { k: ThemePack; live?: boolean }) {
  const p = PACKS[k]
  return (
    <span className={`pack-preview pack-${k}`} style={{ backgroundColor: p.swatch[0] }}>
      {live && <ScenePreview style={p.backdrop} dark={p.theme !== 'light'} />}
      <i style={{ background: p.swatch[1] }} />
      <i style={{ background: p.swatch[2] }} />
      <b style={{ fontFamily: p.font, color: p.swatch[k === 'ink' || k === 'none' ? 2 : 1] }}>Aa 脉</b>
      <em className="pack-fx">{p.entrance}</em>
    </span>
  )
}

/** a section that folds away: the current choice in one line, every option when opened (remembered) */
function Fold({ id, label, current, desc, count, preview, children }: { id: string; label: string; current: string; desc: string; count?: number; preview?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(`tp.fold.${id}`) === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(`tp.fold.${id}`, o ? '0' : '1')
      } catch {
        /* ignore */
      }
      return !o
    })
  return (
    <div className={`set-row fold-row${open ? ' open' : ''}`}>
      <button className="fold-head" onClick={toggle} aria-expanded={open}>
        {preview && <span className="fold-preview">{preview}</span>}
        <span className="fold-text">
          <span className="set-label">
            {label} <span className="bd-cur">· {current}</span>
          </span>
          <span className="set-desc">{desc}</span>
        </span>
        <span className="fold-btn">
          {open ? '收起' : count === undefined ? '展开' : `展开全部 ${count} 个`}
          <i className="fold-chev" />
        </span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div className="fold-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}>
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** every backdrop as a small preview tile, grouped; folded to the current one */
function BackdropPicker({ s, save }: { s: Settings; save: Save }) {
  const cur = BACKDROPS.find((b) => b.value === s.backdrop) ?? BACKDROPS[0]
  return (
    <Fold
      id="backdrops"
      label="背景"
      current={cur.label}
      desc={cur.desc}
      count={BACKDROPS.length}
      preview={
        <span className={`bd-tile bd-${cur.value} fold-bd`}>
          <span className="bd-prev" />
        </span>
      }
    >
      {BACKDROP_CATS.map((cat) => (
        <div key={cat} className="bd-cat">
          <div className="bd-cat-name">{cat}</div>
          <div className="bd-grid" role="radiogroup" aria-label={cat}>
            {BACKDROPS.filter((b) => b.cat === cat).map((b) => (
              <BackdropTile key={b.value} b={b} on={s.backdrop === b.value} dark={resolveTheme(s.theme) === 'dark'} onPick={() => save({ backdrop: b.value })} />
            ))}
          </div>
        </div>
      ))}
    </Fold>
  )
}

/** one backdrop tile, its scene playing under the pointer */
function BackdropTile({ b, on, dark, onPick }: { b: (typeof BACKDROPS)[number]; on: boolean; dark: boolean; onPick: () => void }) {
  const live = useLivePreview()
  return (
    <button role="radio" aria-checked={on} className={`bd-tile bd-${b.value}${on ? ' on' : ''}${live.on ? ' previewing' : ''}`} onClick={onPick} title={`${b.label}：${b.desc}`} {...live.bind}>
      <span className="bd-prev">{live.on && <ScenePreview style={b.value} dark={dark} />}</span>
      <span className="bd-name">{b.label}</span>
    </button>
  )
}

/** the city for sunrise and sunset; empty = guessed from the time zone */
function CityPicker({ place, auto, onPick }: { place: Place; auto: boolean; onPick: (p: Place | null) => void }) {
  return (
    <select
      className="input city-pick"
      value={auto ? '' : place.name}
      onChange={(e) => {
        const c = CITIES.find((x) => x.name === e.target.value)
        onPick(c ? { name: c.name, lat: c.lat, lon: c.lon } : null)
      }}
    >
      <option value="">按时区自动（{placeOf(null).name}）</option>
      {CITIES.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </select>
  )
}

const hmOf = (t: number | null) => (t === null ? '—' : new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }))

/** the place for the sky, and switching packs at sunrise and sunset */
function DayNightRows({ s, save }: { s: Settings; save: Save }) {
  const place = placeOf(s.skyPlace)
  const sun = sunTimes(Date.now(), place)
  const packSelect = (value: ThemePack, key: 'dayPack' | 'nightPack') => (
    <select className="input" value={value} onChange={(e) => save({ [key]: e.target.value as ThemePack })}>
      {PACK_KEYS.map((k) => (
        <option key={k} value={k}>
          {PACKS[k].label}
        </option>
      ))}
    </select>
  )
  return (
    <>
      <Row
        label="日出日落自动换主题"
        desc={`太阳升起时换成白天的主题包，落下时换成夜里的；中途手动换的主题会一直保留到下一次日出或日落${s.dayNight ? '' : '（Claude 默认主题白天用浅色、夜里用深色）'}`}
      >
        <Switch on={s.dayNight} onChange={(dayNight) => save({ dayNight })} />
      </Row>
      {s.dayNight && (
        <Row label="所在城市" desc={`按这里的日出日落切换 · 今天 ${hmOf(sun.rise)} 日出、${hmOf(sun.set)} 日落`}>
          <CityPicker place={place} auto={!s.skyPlace} onPick={(skyPlace) => save({ skyPlace })} />
        </Row>
      )}
      {s.dayNight && (
        <Row label="白天 / 夜里" desc={`白天（${hmOf(sun.rise)} 起）用左边，夜里（${hmOf(sun.set)} 起）用右边`}>
          {packSelect(s.dayPack, 'dayPack')}
          <span className="muted">→</span>
          {packSelect(s.nightPack, 'nightPack')}
        </Row>
      )}
    </>
  )
}

function QuotaRows({ s, save }: { s: Settings; save: Save }) {
  const { guard, setGuard } = useApp()
  const [busy, setBusy] = useState(false)
  const src = SOURCES.find((x) => x.value === s.quotaSource)!
  const bridge = async (on: boolean) => {
    setBusy(true)
    try {
      setGuard(await window.api.installBridge(on))
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <Row label="Claude 订阅额度监控" desc="显示 Claude 的 5 小时与 7 天额度。所有来源都只读，不会刷新或修改登录凭据">
        <Switch on={s.quotaEnabled} onChange={(quotaEnabled) => save({ quotaEnabled })} />
      </Row>
      <Row label="额度数据来源" desc={src.desc}>
        <Segmented value={s.quotaSource} onChange={(quotaSource) => save({ quotaSource })} options={SOURCES} />
      </Row>
      <Row
        label="状态栏桥接"
        desc={
          guard?.bridgeInstalled
            ? '已安装：Claude Code 每次响应后把官方额度数据交给 TokenPulse；原来的状态栏照常显示，后面追加额度信息'
            : '在 Claude Code 的 settings.json 中设置 statusLine，读取官方 rate_limits（会先备份为 settings.json.tokenpulse.bak，关闭时还原）'
        }
      >
        <Switch on={!!guard?.bridgeInstalled} onChange={(on) => !busy && void bridge(on)} />
      </Row>
      <Row label="本地估算 · 5h 上限" desc="等价 API 费用达到多少算 100%。留空则用官方数据自动校准">
        <BudgetInput usd={s.local5hLimitUsd} onSave={(v) => save({ local5hLimitUsd: v })} />
      </Row>
      <WasteRows s={s} save={save} tool="claude" />
    </>
  )
}

/** Remind before a window resets unused; shared by both tools, worded for the one on view */
function WasteRows({ s, save, tool }: { s: Settings; save: Save; tool: 'claude' | 'codex' }) {
  const name = tool === 'codex' ? 'Codex' : 'Claude'
  return (
    <>
      <div className="set-sub">节奏与浪费提醒</div>
      <Row
        label="额度浪费提醒"
        desc={`按最近的速度推算：${name} 5 小时窗口快刷新时还剩 35% 以上、7 天窗口最后一天还剩 25% 以上时提醒（桌面通知、灵动岛、Telegram）。这个开关 Claude 和 Codex 共用`}
      >
        <Switch on={s.wasteAlert} onChange={(wasteAlert) => save({ wasteAlert })} />
      </Row>
      {s.wasteAlert && (
        <>
          <Row label="提前多久提醒" desc="5 小时窗口刷新前多久检查">
            <Segmented
              value={String(s.wasteLeadMin)}
              onChange={(v) => save({ wasteLeadMin: Number(v) })}
              options={[
                { value: '15', label: '15 分钟' },
                { value: '30', label: '30 分钟' },
                { value: '60', label: '1 小时' }
              ]}
            />
          </Row>
          <Row
            label="提醒时提前开始刷新任务"
            desc={`${name} 5 小时额度要浪费时，直接开始队列里最早的 ${name} 任务，用掉这次刷新前剩下的额度${tool === 'claude' ? '（守卫线、暂停和续跑时段照常生效）' : ''}`}
          >
            <Switch on={s.wasteRunTasks} onChange={(wasteRunTasks) => save({ wasteRunTasks })} />
          </Row>
        </>
      )}
    </>
  )
}

/** Codex (GPT): where its logs are read from and what they report */
/** reading Codex's limits from the ChatGPT account, and TokenPulse's own ChatGPT login */
function CodexLoginRows({ s, save }: { s: Settings; save: Save }) {
  const [st, setSt] = useState<CodexUsageState | null>(null)
  const [busy, setBusy] = useState<'' | 'in' | 'out' | 'refresh'>('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => {
    void window.api.codexUsageState().then(setSt)
    return window.api.onCodexUsage(setSt)
  }, [])
  const signIn = async () => {
    setBusy('in')
    setMsg({ ok: true, text: '已在浏览器打开 ChatGPT 登录页，登录后回到这里' })
    const r = await window.api.codexSignIn()
    setBusy('')
    setMsg(r.ok ? { ok: true, text: `已登录${r.email ? ` ${r.email}` : ''}` } : { ok: false, text: r.error ?? '登录失败' })
  }
  const signOut = async () => {
    setBusy('out')
    await window.api.codexSignOut()
    setBusy('')
    setMsg({ ok: true, text: '已退出 TokenPulse 的 ChatGPT 登录' })
  }
  const refresh = async () => {
    setBusy('refresh')
    setSt(await window.api.codexUsageRefresh())
    setBusy('')
  }
  const at = st?.at ? new Date(st.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : ''
  const line =
    st?.status === 'ok'
      ? `正在读取${st.source === 'tokenpulse' ? ' TokenPulse 登录的' : ' Codex CLI 登录的'} ChatGPT 账号${st.email ? `（${st.email}）` : ''} · ${at} 更新`
      : st?.status === 'nologin'
        ? '没有可用的 ChatGPT 登录：点「登录 ChatGPT」，或先在 Codex 里登录'
        : st?.status === 'error'
          ? (st.error ?? '读取失败')
          : '正在读取…'
  return (
    <>
      <Row
        label="从 ChatGPT 账号读取额度"
        desc="每分钟读一次 Codex 的 5 小时 / 7 天额度（Codex 自己的 /status 用的同一个接口），不用等 Codex 运行。优先用 TokenPulse 自己的登录；没有时只读 Codex CLI 的登录，不会刷新它的令牌"
      >
        <Switch on={s.codexUsageApi} onChange={(codexUsageApi) => save({ codexUsageApi })} />
      </Row>
      {s.codexUsageApi && (
        <div className="tg-box">
          <div className="tg-row">
            <span className="tg-label">状态</span>
            <span className={st?.status === 'error' ? 'bad-text' : st?.status === 'ok' ? 'ok-text' : 'muted'}>{line}</span>
          </div>
          <div className="tg-row">
            <span className="tg-label">账号</span>
            {st?.loggedIn ? (
              <>
                <span>TokenPulse 已登录{st.email ? ` ${st.email}` : ''}</span>
                <button className="btn small" disabled={!!busy} onClick={() => void signOut()}>
                  退出登录
                </button>
              </>
            ) : (
              <button className="btn primary small" disabled={!!busy} onClick={() => void signIn()}>
                {busy === 'in' ? '等待浏览器…' : '登录 ChatGPT'}
              </button>
            )}
            <button className="btn small" disabled={!!busy} onClick={() => void refresh()}>
              {busy === 'refresh' ? '读取中…' : '立即刷新'}
            </button>
            {msg && <span className={msg.ok ? 'ok-text' : 'bad-text'}>{msg.text}</span>}
          </div>
          <div className="set-note">
            登录走 OpenAI 的官方页面（和 codex login 同一套 OAuth），令牌用系统的数据保护加密后只存在本机。
            {st?.cliLogin ? '检测到 Codex CLI 已经登录，没有登录 TokenPulse 时直接用它（只读）。' : '没有检测到 Codex CLI 的登录。'}
          </div>
        </div>
      )}
    </>
  )
}

function CodexRows({ s, save }: { s: Settings; save: Save }) {
  const { load, codexQuota } = useApp()
  const dirs = load?.codexDirs ?? []
  return (
    <>
      <Row
        label="读取 Codex 用量"
        desc={
          s.codexEnabled
            ? dirs.length
              ? `读取 ${load?.codexFiles ?? 0} 个 Codex 会话文件。侧边栏顶部切换 Claude / Codex / 全部：Codex 视图有自己的图标、配色、额度、节奏、回本和设置，两边互不掺杂，只在「全部」里一起看`
              : '没有找到 Codex 会话目录（~/.codex/sessions，或 CODEX_HOME 指定的位置）'
            : '读取 Codex CLI 的会话日志（只读），显示 GPT 用量和 ChatGPT 套餐的 5 小时 / 7 天额度'
        }
      >
        <Switch on={s.codexEnabled} onChange={(codexEnabled) => save({ codexEnabled })} />
      </Row>
      {s.codexEnabled && <CodexLoginRows s={s} save={save} />}
      {s.codexEnabled && (
        <>
          <Row
            label="Tibo 重置播报"
            desc="在 Codex 概览里跟踪 Tibo（@thsottiaux，Codex 负责人）在 X 上发的额度重置：刚重置、已预告、在暗示，以及你自己的 7 天额度有没有跟着清零；他的 28 天挑战进行期间，另有一张卡片记录每天是改进还是重置。X 的接口要付费，帖子经 codex-resets.com 读取，每 10 分钟一次"
          >
            <Switch on={s.codexResetWatch} onChange={(codexResetWatch) => save({ codexResetWatch })} />
          </Row>
          {s.codexResetWatch && (
            <Row label="重置提醒" desc="Tibo 宣布、预告或暗示重置时弹出系统通知；开着 Telegram 的「额度提醒与重置」推送时也发到手机">
              <Switch on={s.codexResetNotify} onChange={(codexResetNotify) => save({ codexResetNotify })} />
            </Row>
          )}
          {s.codexResetWatch && (
            <Row label="帖子语言" desc="Tibo 的帖子、28 天挑战和提醒里的原文用哪种语言显示。译文由 codex-resets.com 提供，原文 = 照他在 X 上发的">
              <Segmented small value={s.codexResetLang} onChange={(codexResetLang) => save({ codexResetLang })} options={RESET_LANGS} />
            </Row>
          )}
        </>
      )}
      {s.codexEnabled && dirs.length > 0 && (
        <div className="guard-info">
          {dirs.map((d) => (
            <div key={d} className="mono">
              {d}
            </div>
          ))}
          <div className="muted">
            {codexQuota
              ? `ChatGPT ${codexQuota.plan ?? ''} · ${codexQuota.windows.map((w) => `${w.label} ${Math.round(w.utilization)}%`).join(' · ')}（${codexQuota.origin === 'api' ? '账号接口，每分钟更新' : 'Codex 运行时更新'}）`
              : '日志里还没有额度数据'}
            。费用按 OpenAI API 价格估算，新模型按最接近的 GPT 型号估算；经 Codex 调用的其他模型（DeepSeek、Grok 等）没有价格时只计 Token。
          </div>
        </div>
      )}
      {s.codexEnabled && (
        <>
          <WasteRows s={s} save={save} tool="codex" />
          <div className="set-note">额度守卫目前只管 Claude Code（靠 Claude Code 的钩子暂停任务）；Codex 5 小时额度用完时，排队的 Codex 任务会等到刷新后再开始。</div>
        </>
      )}
    </>
  )
}

function GuardRows({ s, save }: { s: Settings; save: Save }) {
  const { guard } = useApp()
  return (
    <>
      <Row label="额度守卫" desc="5 小时额度达到阈值时，暂停正在运行的 Claude Code 任务（下一次工具调用或新提问时等待），额度窗口重置后自动继续。通过 Claude Code 钩子实现">
        <Switch on={s.guardEnabled} onChange={(guardEnabled) => save({ guardEnabled })} />
      </Row>
      <Row label="暂停阈值" desc="5h 额度百分比，50–99。官方状态栏每次响应后更新，用量接口在接近阈值时每分钟刷新">
        <PercentSlider value={s.guardPauseAt} min={50} max={99} onSave={(guardPauseAt) => save({ guardPauseAt })} />
      </Row>
      <Row
        label="7 天额度暂停线"
        desc={s.guardWeeklyAt ? `7 天额度达到 ${s.guardWeeklyAt}% 时也暂停；重置较远时直接停止任务并说明原因` : '关闭时只看 5 小时额度。开启后 7 天额度到线也会暂停，保护整周的额度'}
      >
        <Switch on={s.guardWeeklyAt !== null} onChange={(on) => save({ guardWeeklyAt: on ? 95 : null })} />
        {s.guardWeeklyAt !== null && <PercentSlider value={s.guardWeeklyAt} min={50} max={100} onSave={(guardWeeklyAt) => save({ guardWeeklyAt })} />}
      </Row>
      <Row label="只在指定时段自动续跑" desc="额度重置后，只在这段时间内让暂停的任务继续（可跨午夜，例如 00:00–08:00 让任务夜里跑、白天把额度留给你）">
        <Switch on={!!s.guardResumeFrom && !!s.guardResumeTo} onChange={(on) => save(on ? { guardResumeFrom: '00:00', guardResumeTo: '08:00' } : { guardResumeFrom: null, guardResumeTo: null })} />
        {s.guardResumeFrom && s.guardResumeTo && (
          <>
            <input type="time" className="input tnum" value={s.guardResumeFrom} onChange={(e) => save({ guardResumeFrom: e.target.value })} />
            <span className="muted">至</span>
            <input type="time" className="input tnum" value={s.guardResumeTo} onChange={(e) => save({ guardResumeTo: e.target.value })} />
          </>
        )}
      </Row>
      {guard && (
        <div className="guard-info">
          <div>
            钩子：{guard.hookInstalled ? <b className="ok">已安装</b> : <b>未安装</b>}
            {' · '}状态栏桥接：{guard.bridgeInstalled ? <b className="ok">已安装</b> : <b>未安装</b>}
            {guard.manualHold && (
              <>
                {' · '}
                <b className="bad">已手动暂停所有任务</b>
              </>
            )}
            {guard.paused.length > 0 && (
              <>
                {' · '}
                <b className="bad">暂停中 {guard.paused.length} 个任务</b>
              </>
            )}
          </div>
          {guard.claudeSettings && <div className="mono">{guard.claudeSettings}</div>}
          {guard.nodePath && <div className="mono">Node.js：{guard.nodePath}</div>}
          {guard.error && <div className="bad">⚠ {guard.error}</div>}
          <div className="muted">提示：暂停期间在 Claude Code 中按 Esc 可以立即取消等待。官方数据过期超过 20 分钟时守卫不会触发暂停，避免误停。</div>
        </div>
      )}
    </>
  )
}

/** Codex models seen in the logs, newest name first, for the model pickers */
export function useCodexModels(): string[] {
  const { pricing } = useApp()
  return (pricing?.models ?? [])
    .filter((m) => m.source === 'codex' && /^gpt-/i.test(m.model) && m.model !== 'gpt-unknown')
    .sort((a, b) => (b.lastSeen ?? 0) - (a.lastSeen ?? 0))
    .map((m) => m.model)
}

function TaskRows({ s, save, q, source }: { s: Settings; save: Save; q: TaskQueueState | null; source: SourceView }) {
  const codexModels = useCodexModels()
  const claude = source === 'claude' || source === 'all'
  const codex = (source === 'codex' || source === 'all') && s.codexEnabled
  return (
    <>
      <Row
        label="在终端窗口里运行"
        desc={
          !q?.node
            ? '没有找到 Node.js，任务只能在后台运行（日志照样能在任务页看）。装好 Node.js 并加入 PATH 后重启 TokenPulse 即可'
            : s.taskTerminal
              ? '每个文件夹一个终端窗口：思考过程、工具调用和回答实时显示，同一文件夹的任务在同一个窗口里依次执行；TokenPulse 里保留同样的日志，关掉 TokenPulse 任务也会继续'
              : '任务在后台静默运行，只能在任务页看日志'
        }
      >
        <Switch on={s.taskTerminal && !!q?.node} onChange={(taskTerminal) => save({ taskTerminal })} />
      </Row>
      <Row label="默认工作目录" desc="新任务和 Telegram /task 默认在这里执行">
        <input className="input mono" style={{ width: 280 }} value={s.taskCwd} placeholder="选择一个项目文件夹" onChange={(e) => save({ taskCwd: e.target.value })} />
        <button className="btn small" onClick={() => void window.api.pickFolder().then((p) => p && save({ taskCwd: p }))}>
          选择…
        </button>
      </Row>
      <Row
        label="接着上次的对话"
        desc={
          !s.taskContinue
            ? '每个任务都开一个全新的对话'
            : source === 'workbuddy'
              ? '默认开启：接着这个文件夹最近一次 WorkBuddy 会话，并分叉成新会话。文件夹里还没有会话时自动开新的'
            : source === 'codex'
              ? '默认开启：新任务接着这个文件夹最近一次 Codex 会话继续（codex exec resume）。文件夹里还没有会话时自动开新的'
              : source === 'claude'
                ? '默认开启：新任务接着这个文件夹最近一次对话继续（claude -c，并分叉成新会话，不会写进你开着的对话）。文件夹里还没有对话时自动开新的'
                : '默认开启：新任务接着这个文件夹最近一次对话继续（Claude 用 -c 并分叉成新会话，不会写进你开着的对话；Codex 用 resume）。文件夹里还没有对话时自动开新的'
        }
      >
        <Switch on={s.taskContinue} onChange={(taskContinue) => save({ taskContinue })} />
      </Row>
      {claude && (
        <>
          <div className="set-sub">Claude Code</div>
          <Row label="Claude Code 命令" desc={q?.claude ? 'claude -p，无人值守执行' : '没有找到 claude 命令，请确认 Claude Code 已安装并在 PATH 中'}>
            <span className={`mono ${q?.claude ? '' : 'bad-text'}`}>{q?.claude ?? '未找到'}</span>
          </Row>
          <Row label="默认权限" desc="任务里的工具调用怎么放行；无人值守时需要确认的操作会被拒绝">
            <select className="input" value={s.taskPermission} onChange={(e) => save({ taskPermission: e.target.value as TaskPermission })}>
              {TASK_PERMISSIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="默认模型" desc="留空用 Claude Code 当前的默认模型">
            <select className="input" value={s.taskModel ?? ''} onChange={(e) => save({ taskModel: e.target.value || null })}>
              <option value="">默认</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </Row>
        </>
      )}
      {codex && (
        <>
          <div className="set-sub">Codex</div>
          <Row label="Codex 命令" desc={q?.tools.codex.cli ? 'codex exec，无人值守执行' : '没有找到 codex 命令（PATH、~/.npm-global、%APPDATA%\\npm 里都没有）'}>
            <span className={`mono ${q?.tools.codex.cli ? '' : 'bad-text'}`}>{q?.tools.codex.cli ?? '未找到'}</span>
          </Row>
          <Row label="默认沙箱" desc={CODEX_PERMISSIONS.find((p) => p.value === s.codexTaskPermission)?.desc ?? ''}>
            <select className="input" value={s.codexTaskPermission} onChange={(e) => save({ codexTaskPermission: e.target.value as TaskPermission })}>
              {CODEX_PERMISSIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Row>
          <Row
            label="默认模型"
            desc="留空用 config.toml 里的模型；列表来自你的 Codex 日志。任务用 ChatGPT 账号直接调用 Codex，有些型号（例如 gpt-6.1-sol）这样调用会被拒绝，gpt-5.5 实测可用"
          >
            <select className="input" value={s.codexTaskModel ?? ''} onChange={(e) => save({ codexTaskModel: e.target.value || null })}>
              <option value="">默认</option>
              {codexModels.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Row>
          <Row label="模型被拒时自动换用" desc={s.codexModelFallback ? '被拒的模型会自动换成 gpt-5.5 重试' : '被拒时任务直接失败，并提示该换哪个模型'}>
            <Switch on={s.codexModelFallback} onChange={(codexModelFallback) => save({ codexModelFallback })} />
          </Row>
        </>
      )}
      <div className="set-sub">上下文</div>
      <Row
        label="自动压缩的时机"
        desc={source === 'workbuddy' ? 'WorkBuddy 按当前模型自动压缩，也可以指定 100K–1M Token 阈值。每个任务可以单独设置' : `默认要等上下文满了才压缩；长任务可以提前压缩，让对话一直保持精简（${claude && codex ? 'Claude 用 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE 和 CLAUDE_CODE_AUTO_COMPACT_WINDOW，Codex 用 model_auto_compact_token_limit' : codex ? 'Codex 的 model_auto_compact_token_limit' : 'Claude Code 的 CLAUDE_AUTOCOMPACT_PCT_OVERRIDE 和 CLAUDE_CODE_AUTO_COMPACT_WINDOW'}）。每个任务也可以单独设置`}
      >
        <CompactPicker
          tool={source === 'workbuddy' ? 'workbuddy' : claude ? 'claude' : 'codex'}
          value={{ on: s.taskAutoCompact, at: s.taskCompactAt }}
          onChange={(c) => save({ taskAutoCompact: c.on, taskCompactAt: c.at })}
        />
      </Row>
      <div className="set-sub">试错</div>
      <Row
        label="失败后自动重试"
        desc={
          source === 'workbuddy' ? '失败按设定次数重试；积分不足时停止，补充后手动重试' : s.taskRetries
            ? `新任务失败后最多再试 ${s.taskRetries} 次：网络出错等一会儿再试，检查没通过就把输出交给它接着修，其他失败接着原来的对话换个做法。额度用完不算次数，刷新后自动接着做`
            : '新任务失败了就停下（额度用完时仍会等刷新后接着做）'
        }
      >
        <select className="input" value={s.taskRetries} onChange={(e) => save({ taskRetries: Number(e.target.value) })}>
          {[0, 1, 2, 3, 5].map((n) => (
            <option key={n} value={n}>
              {n ? `${n} 次` : '不重试'}
            </option>
          ))}
        </select>
      </Row>
      <Row label="每次尝试最长" desc="一次尝试超过这个时间就停下，还有重试次数的话接着做；每个任务也可以单独设置">
        <select className="input" value={s.taskTimeoutMin ?? 0} onChange={(e) => save({ taskTimeoutMin: Number(e.target.value) || null })}>
          {[0, 15, 30, 60, 120, 240].map((n) => (
            <option key={n} value={n}>
              {n ? (n >= 60 ? `${n / 60} 小时` : `${n} 分钟`) : '不限时'}
            </option>
          ))}
        </select>
      </Row>
      <div className="set-sub">队列</div>
      <Row label="暂停队列" desc="排好的任务先不执行；正在执行的任务不受影响">
        <Switch on={s.taskQueuePaused} onChange={(taskQueuePaused) => save({ taskQueuePaused })} />
      </Row>
      <Row label="管理任务" desc="发布任务、拖动排序、设置子任务、查看进度和日志">
        <button className="btn" onClick={() => document.dispatchEvent(new CustomEvent('tp-nav', { detail: 'tasks' }))}>
          打开任务页
        </button>
      </Row>
    </>
  )
}

function RunawayRows({ s, save, source }: { s: Settings; save: Save; source: SourceView }) {
  return (
    <>
      <Row
        label="上下文膨胀提醒"
        desc="会话里每次请求带上的上下文太大时提醒你 /compact（桌面通知、概览横幅、灵动岛）。每个会话最多提醒两次，压缩后重新计算；会话页能看每个会话的上下文曲线"
      >
        <Switch on={s.contextAlert} onChange={(contextAlert) => save({ contextAlert })} />
      </Row>
      {s.contextAlert && (
        <Row
          label="提醒线"
          desc={
            s.contextAuto
              ? '自动：按模型窗口判断（Claude 200K/1M；Codex 读取日志窗口；WorkBuddy 只读本机模型窗口，未知时使用固定提醒线），用到 70% 提醒一次、88% 再提醒一次'
              : `固定：上下文到 ${s.contextWarnK}k 提醒，到 ${Math.round(s.contextWarnK * 1.5)}k 再提醒一次，不管模型的窗口有多大`
          }
        >
          <Segmented
            value={s.contextAuto ? 'auto' : String(s.contextWarnK)}
            onChange={(v) => save(v === 'auto' ? { contextAuto: true } : { contextAuto: false, contextWarnK: Number(v) })}
            options={[{ value: 'auto', label: '自动' }, ...[80, 120, 160, 250, 400].map((k) => ({ value: String(k), label: `${k}k` }))]}
          />
        </Row>
      )}
      <Row label="失控检测" desc="以你过去 7 天的正常强度为基准：某个会话 5 分钟内的消耗远超平时，或连续十几次输出完全相同的响应（卡在同一个失败的操作上），立即提醒">
        <Switch on={s.runawayDetect} onChange={(runawayDetect) => save({ runawayDetect })} />
      </Row>
      {s.runawayDetect && (
        <>
          <Row
            label="灵敏度"
            desc={
              {
                low: '宽松：5 分钟超过平时 5 倍（至少 $8）或连续 18 次相同响应',
                medium: '标准：超过平时 3.5 倍（至少 $5）或连续 14 次相同响应',
                high: '灵敏：超过平时 2.5 倍（至少 $3）或连续 10 次相同响应'
              }[s.runawaySensitivity]
            }
          >
            <Segmented
              value={s.runawaySensitivity}
              onChange={(runawaySensitivity) => save({ runawaySensitivity })}
              options={[
                { value: 'low', label: '宽松' },
                { value: 'medium', label: '标准' },
                { value: 'high', label: '灵敏' }
              ]}
            />
          </Row>
          {source === 'codex' || source === 'workbuddy' ? (
            <div className="set-note">{source === 'workbuddy' ? 'WorkBuddy' : 'Codex'} 会话失控时只会提醒（应用内、桌面通知、Telegram），请到工具里手动停止。</div>
          ) : (
            <Row
              label={source === 'all' ? '发现后（Claude 会话）' : '发现后'}
              desc={
                s.runawayAction === 'pause'
                  ? `提醒并暂停那一个会话（其他会话不受影响），在概览页、灵动岛或 Telegram 里恢复。需要守卫钩子，首次开启只对之后新开的会话生效${source === 'all' ? '；Codex 会话只提醒' : ''}`
                  : '只提醒（应用内、桌面通知、Telegram），由你决定是否暂停'
              }
            >
              <Segmented
                value={s.runawayAction}
                onChange={(runawayAction) => save({ runawayAction })}
                options={[
                  { value: 'notify', label: '只提醒' },
                  { value: 'pause', label: '提醒并暂停该会话' }
                ]}
              />
            </Row>
          )}
        </>
      )}
    </>
  )
}

function NotifyRows({ s, save, source }: { s: Settings; save: Save; source: SourceView }) {
  const { saveSettings } = useApp()
  const [token, setToken] = useState(s.telegramToken)
  const [chat, setChat] = useState(s.telegramChatId)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState('')
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => setToken(s.telegramToken), [s.telegramToken])
  useEffect(() => setChat(s.telegramChatId), [s.telegramChatId])
  const detect = async () => {
    setBusy('detect')
    const r = await window.api.telegramDetectChat(token)
    setBusy('')
    if (r.ok && r.chatId) {
      save({ telegramToken: token, telegramChatId: r.chatId })
      setResult({ ok: true, text: `已找到会话${r.name ? `「${r.name}」` : ''}，Chat ID ${r.chatId}` })
    } else setResult({ ok: false, text: r.error ?? '获取失败' })
  }
  const run = async (kind: 'test' | 'report') => {
    await saveSettings({ telegramToken: token, telegramChatId: chat })
    setBusy(kind)
    const r = kind === 'test' ? await window.api.telegramTest() : await window.api.sendReport()
    setBusy('')
    setResult(r.ok ? { ok: true, text: kind === 'test' ? '测试消息已发送，去 Telegram 看看' : '晚报已发送' } : { ok: false, text: r.error ?? '发送失败' })
  }
  const events: { key: 'pushGuard' | 'pushQuota' | 'pushBudget' | 'pushAchievement' | 'pushRunaway' | 'pushTasks'; label: string }[] = [
    // the guard only ever holds Claude Code
    ...(source === 'claude' || source === 'all' ? [{ key: 'pushGuard' as const, label: '守卫暂停 / 恢复' }] : []),
    { key: 'pushQuota', label: '额度提醒与重置' },
    { key: 'pushTasks', label: '刷新任务' },
    { key: 'pushRunaway', label: '失控会话' },
    { key: 'pushBudget', label: '预算提醒' },
    { key: 'pushAchievement', label: '成就解锁' }
  ]
  return (
    <>
      <Row label="音效" desc="新用量时轻轻的滴水声，额度到 75% / 90% 的提示音，守卫暂停与恢复、失控会话、解锁成就各有一种声音">
        <Switch on={s.sound} onChange={(sound) => save({ sound })} />
        {s.sound && <PercentSlider value={Math.round(s.soundVolume * 100)} min={0} max={100} onSave={(v) => save({ soundVolume: v / 100 })} />}
      </Row>
      <Row label="Telegram 推送与遥控" desc="守卫暂停、额度提醒、刷新任务结果推送到手机，还能在 Telegram 里发指令控制。网络走系统代理">
        <Switch on={s.telegramEnabled} onChange={(telegramEnabled) => save({ telegramEnabled })} />
      </Row>
      {s.telegramEnabled && (
        <div className="tg-box">
          <ol className="tg-steps">
            <li>
              在 Telegram 里找 <b>@BotFather</b>，发送 <span className="mono">/newbot</span> 创建机器人，复制它给你的 Token
            </li>
            <li>打开你的机器人，随便发一条消息</li>
            <li>回到这里粘贴 Token，点「自动获取」，再点「发送测试」</li>
          </ol>
          <div className="tg-row">
            <span className="tg-label">Bot Token</span>
            <input
              className="input mono"
              type={show ? 'text' : 'password'}
              placeholder="123456789:ABC..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              onBlur={() => token !== s.telegramToken && save({ telegramToken: token })}
            />
            <button className="btn small" onClick={() => setShow(!show)}>
              {show ? '隐藏' : '显示'}
            </button>
          </div>
          <div className="tg-row">
            <span className="tg-label">Chat ID</span>
            <input className="input mono" placeholder="自动获取或手动填写" value={chat} onChange={(e) => setChat(e.target.value)} onBlur={() => chat !== s.telegramChatId && save({ telegramChatId: chat })} />
            <button className="btn small" disabled={!token || !!busy} onClick={detect}>
              {busy === 'detect' ? '获取中…' : '自动获取'}
            </button>
          </div>
          <div className="tg-row">
            <span className="tg-label">推送内容</span>
            <span className="tg-events">
              {events.map((ev) => (
                <label key={ev.key} className="check">
                  <input type="checkbox" checked={s[ev.key]} onChange={(e) => save({ [ev.key]: e.target.checked })} />
                  {ev.label}
                </label>
              ))}
            </span>
          </div>
          <div className="tg-row">
            <span className="tg-label">远程指令</span>
            <label className="check">
              <input type="checkbox" checked={s.telegramCommands} onChange={(e) => save({ telegramCommands: e.target.checked })} />
              /panel /status /card /today /week /top /star /ach /sign /luck /tasks /task /log /pause /resume /guard /report /board（只响应上面这个 Chat ID）
            </label>
          </div>
          {s.telegramCommands && (
            <div className="tg-row">
              <span className="tg-label">按钮键盘</span>
              <Segmented small value={s.telegramKeyboard} onChange={(telegramKeyboard) => save({ telegramKeyboard })} options={TG_KEYBOARDS} />
              <span className="muted" style={{ fontSize: 12 }}>
                {TG_KEYBOARDS.find((k) => k.value === s.telegramKeyboard)?.desc}
              </span>
            </div>
          )}
          <div className="tg-row">
            <span className="tg-label">花样</span>
            <span className="tg-events">
              <label className="check">
                <input type="checkbox" checked={s.telegramEffects} onChange={(e) => save({ telegramEffects: e.target.checked })} />
                全屏特效与表情回应（成就 🎉、任务完成 👍、额度爆表 🔥）
              </label>
              <label className="check">
                <input type="checkbox" checked={s.telegramAnimations} onChange={(e) => save({ telegramAnimations: e.target.checked })} />
                动画：今日卡片是动图、额度提醒配仪表动画、状态回复逐帧展开
              </label>
              <label className="check">
                <input type="checkbox" checked={s.telegramCardReport} onChange={(e) => save({ telegramCardReport: e.target.checked })} />
                晚报附一张今日卡片（图片）
              </label>
              <label className="check">
                <input type="checkbox" checked={s.telegramBoard} onChange={(e) => save({ telegramBoard: e.target.checked })} />
                置顶实时看板：聊天顶部一直显示额度，每分钟悄悄更新
              </label>
            </span>
          </div>
          <div className="tg-row">
            <span className="tg-label">免打扰</span>
            <label className="check">
              <input
                type="checkbox"
                checked={s.telegramQuietFrom !== null && s.telegramQuietTo !== null}
                onChange={(e) => save(e.target.checked ? { telegramQuietFrom: '23:00', telegramQuietTo: '08:00' } : { telegramQuietFrom: null, telegramQuietTo: null })}
              />
              推送静音
            </label>
            {s.telegramQuietFrom !== null && s.telegramQuietTo !== null && (
              <>
                <input type="time" className="input tnum" style={{ flex: 'none', width: 136 }} value={s.telegramQuietFrom} onChange={(e) => save({ telegramQuietFrom: e.target.value })} />
                <span className="muted">–</span>
                <input type="time" className="input tnum" style={{ flex: 'none', width: 136 }} value={s.telegramQuietTo} onChange={(e) => save({ telegramQuietTo: e.target.value })} />
              </>
            )}
            <span className="muted" style={{ fontSize: 12 }}>
              这段时间的推送照常送达，只是不响铃
            </span>
          </div>
          <div className="tg-row">
            <span className="tg-label">每日晚报</span>
            <label className="check">
              <input type="checkbox" checked={s.reportTime !== null} onChange={(e) => save({ reportTime: e.target.checked ? '22:00' : null })} />
              每天
            </label>
            {s.reportTime !== null && <input type="time" className="input tnum" style={{ flex: 'none', width: 136 }} value={s.reportTime} onChange={(e) => save({ reportTime: e.target.value })} />}
            <span className="muted" style={{ fontSize: 12 }}>
              今日用量、额度、7 天预测和回本倍数{s.telegramCardReport ? '，配一张今日卡片' : ''}
            </span>
          </div>
          <div className="tg-row">
            <span className="tg-label" />
            <button className="btn primary small" disabled={!token || !chat || !!busy} onClick={() => void run('test')}>
              {busy === 'test' ? '发送中…' : '发送测试'}
            </button>
            <button className="btn small" disabled={!token || !chat || !!busy} onClick={() => void run('report')}>
              {busy === 'report' ? '发送中…' : '立即发送晚报'}
            </button>
            {result && <span className={result.ok ? 'ok-text' : 'bad-text'}>{result.text}</span>}
          </div>
        </div>
      )}
    </>
  )
}

function IslandRows({ s, save }: { s: Settings; save: Save }) {
  return (
    <>
      <Row label="灵动岛" desc="屏幕顶部正中的黑色胶囊：平时显示今日用量和 5h 额度；额度提醒、守卫暂停、失控会话、刷新任务、远程指令、成就解锁时弹开；鼠标悬停看详情并可一键暂停任务">
        <Switch on={s.island} onChange={(island) => save({ island })} />
      </Row>
      <div className="set-note">胶囊以外的区域不挡鼠标；点胶囊打开主窗口，右键可以关闭。托盘菜单里也能开关。它始终置顶，全屏播放视频时也会显示。</div>
    </>
  )
}

function HotkeyRow({ s, save }: { s: Settings; save: Save }) {
  const [status, setStatus] = useState<HotkeyStatus | null>(null)
  useEffect(() => {
    void window.api.hotkeyStatus().then(setStatus)
  }, [s.globalHotkey, s.hotkey])
  const wanted = hotkeyLabel(s.hotkey)
  const desc = !s.globalHotkey
    ? '在任何程序里用快捷键呼出或隐藏悬浮窗'
    : !status
      ? ''
      : status.active === null
        ? '这些组合键都被其他程序占用了，暂时无法注册'
        : status.active !== status.wanted
          ? `${wanted} 已被其他程序占用，已自动改用 ${hotkeyLabel(status.active)}`
          : `已启用：在任何程序里按 ${wanted} 呼出或隐藏悬浮窗`
  return (
    <Row label="全局快捷键" desc={desc}>
      {s.globalHotkey && (
        <select className="input" value={s.hotkey} onChange={(e) => save({ hotkey: e.target.value as Hotkey })}>
          {HOTKEYS.map((h) => (
            <option key={h} value={h}>
              {hotkeyLabel(h)}
            </option>
          ))}
        </select>
      )}
      <Switch on={s.globalHotkey} onChange={(globalHotkey) => save({ globalHotkey })} />
    </Row>
  )
}

function MiniRows({ s, save }: { s: Settings; save: Save }) {
  return (
    <>
      <Row label="悬浮窗" desc="置顶的迷你窗口，可拖动；拖到屏幕边缘会自动吸附。右键悬浮窗可以快速切换下面这些选项">
        <Switch on={s.showMini} onChange={(showMini) => save({ showMini })} />
      </Row>
      <Row label="显示模式" desc={MINI_DESC[s.miniMode]}>
        <Segmented value={s.miniMode} onChange={(miniMode) => save({ miniMode })} options={MINI_MODES} />
      </Row>
      <Row label="大小" desc="整体缩放悬浮窗">
        <Segmented value={String(s.miniScale)} onChange={(v) => save({ miniScale: Number(v) })} options={MINI_SCALES} />
      </Row>
      <Row label="不透明度" desc="30–100%">
        <PercentSlider value={Math.round(s.miniOpacity * 100)} min={30} max={100} onSave={(v) => save({ miniOpacity: v / 100 })} />
      </Row>
      <Row label="贴边自动隐藏" desc="吸附在屏幕左、右或上边缘时，鼠标离开后滑进边缘只露出一条细边，鼠标靠近时滑出">
        <Switch on={s.miniEdgeHide} onChange={(miniEdgeHide) => save({ miniEdgeHide })} />
      </Row>
      <Row label="鼠标穿透" desc="开启后点击会穿过悬浮窗，不挡住下面的窗口；可在这里或托盘菜单「悬浮窗样式」中关闭">
        <Switch on={s.miniClickThrough} onChange={(miniClickThrough) => save({ miniClickThrough })} />
      </Row>
      <HotkeyRow s={s} save={save} />
    </>
  )
}

function DesktopRows({ s, save }: { s: Settings; save: Save }) {
  return (
    <>
      <Row label="大屏模式" desc="全屏仪表盘，有第二块屏幕时自动放到副屏；也可以在主窗口按 F11，Esc 退出">
        <button className="btn" onClick={() => window.api.openStage()}>
          打开大屏
        </button>
      </Row>
      <Row label="动态壁纸" desc="把当前背景（流光 / 星河 / 极光 / 涟漪）铺到桌面壁纸上，桌面图标照常在上面。关闭后恢复原壁纸；会持续占用少量 GPU">
        <Switch on={s.wallpaper} onChange={(wallpaper) => save({ wallpaper })} />
      </Row>
    </>
  )
}

function MoneyRows({ s, save, source }: { s: Settings; save: Save; source: SourceView }) {
  const [rate, setRate] = useState(String(s.cnyRate))
  useEffect(() => setRate(String(s.cnyRate)), [s.cnyRate])
  return (
    <>
      <Row label="货币" desc="费用按美元计算，人民币按下方汇率换算显示">
        <Segmented
          value={s.currency}
          onChange={(currency) => save({ currency })}
          options={[
            { value: 'USD', label: 'USD $' },
            { value: 'CNY', label: 'CNY ¥' }
          ]}
        />
      </Row>
      <Row label="汇率" desc="1 美元兑人民币">
        <input
          className="input tnum"
          style={{ width: 100, textAlign: 'right' }}
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          onBlur={() => {
            const n = Number(rate)
            if (Number.isFinite(n) && n > 0) save({ cnyRate: n })
            else setRate(String(s.cnyRate))
          }}
        />
      </Row>
      <Row label="每日预算" desc="能量罐以此为容量；用到 80% 和 100% 时提醒。留空则按近 30 天日均自适应">
        <BudgetInput usd={s.dailyBudget} onSave={(v) => save({ dailyBudget: v })} />
      </Row>
      <Row label="每月预算" desc="本月累计费用达到 80% 和 100% 时提醒">
        <BudgetInput usd={s.monthlyBudget} onSave={(v) => save({ monthlyBudget: v })} />
      </Row>
      {source === 'workbuddy' ? (
        <div className="set-note">WorkBuddy 按积分计费；API 等价费用用于比较模型用量，不能换算为实际扣费或账户剩余额度。</div>
      ) : source === 'codex' ? (
        <div className="set-note">Codex 的回本倍数按日志里识别到的 ChatGPT 套餐月费计算（Plus $20、Pro $200）。</div>
      ) : (
        <Row label="Claude 订阅月费" desc="用于计算回本倍数。留空则按识别到的计划（Pro $20、Max 5x $100、Max 20x $200）">
          <BudgetInput usd={s.planPrice} onSave={(v) => save({ planPrice: v })} />
        </Row>
      )}
    </>
  )
}

/** the version, and updating from the GitHub releases */
function UpdateRows({ s, save }: { s: Settings; save: Save }) {
  const u = useUpdate()
  const [busy, setBusy] = useState(false)
  if (!u) return null
  const v = u.latest?.version
  const newer = u.status === 'available' || u.status === 'downloading' || u.status === 'ready'
  const status =
    u.status === 'checking'
      ? '正在检查…'
      : u.status === 'none'
        ? `已是最新版本${u.checkedAt ? `（${new Date(u.checkedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} 检查）` : ''}`
        : u.status === 'available'
          ? `发现新版本 ${v}${u.latest?.size ? `（${(u.latest.size / 1048576).toFixed(0)} MB）` : ''}`
          : u.status === 'downloading'
            ? `正在下载 ${v}… ${Math.round((u.progress ?? 0) * 100)}%`
            : u.status === 'ready'
              ? `${v} 已下载并校验，重启即可更新`
              : u.status === 'error'
                ? (u.error ?? '更新出错')
                : '还没有检查'
  const check = async () => {
    setBusy(true)
    await window.api.updateCheck()
    setBusy(false)
  }
  return (
    <>
      <div className={`set-row upd-row${newer ? ' newer' : ''}`}>
        <div className="upd-row-main">
          <img className="upd-row-icon" src={APP_ICON} alt="" draggable={false} />
          <div>
            <div className="set-label">
              TokenPulse {u.current}
              <span className="badge">{u.kind === 'portable' ? '便携版' : u.kind === 'installer' ? '安装版' : '开发版'}</span>
            </div>
            <div className={`upd-row-status${u.status === 'error' ? ' bad-text' : newer ? ' ok-text' : ''}`}>{status}</div>
          </div>
        </div>
        <div className="set-ctl">
          {newer ? (
            <button className="btn primary small" onClick={openUpdateDialog}>
              {u.status === 'ready' ? '重启并更新' : u.status === 'downloading' ? '查看进度' : '查看并更新'}
            </button>
          ) : (
            <button className="btn small" disabled={busy || u.status === 'checking'} onClick={() => void check()}>
              检查更新
            </button>
          )}
        </div>
      </div>
      <Row label="启动时检查更新" desc="每次打开 TokenPulse 都会到 GitHub Releases 看一下，有新版本就弹窗展示更新内容；下载和安装都等你点「立即更新」，不会突然重启">
        <Switch on={s.autoUpdate} onChange={(autoUpdate) => save({ autoUpdate })} />
      </Row>
    </>
  )
}

function WorkBuddyLoginRows() {
  const [refreshKey, setRefreshKey] = useState(0)
  const st = useData(() => window.api.getWorkBuddyLoginState(), [refreshKey], 3000)
  const [busy, setBusy] = useState<'' | 'in' | 'out' | 'refresh'>('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const signIn = async () => {
    setBusy('in'); setMsg({ ok: true, text: '正在打开官方登录页，完成授权后回到这里' })
    try {
      const result = await window.api.workbuddySignIn()
      if (result.ok) setMsg({ ok: true, text: '已登录，正在读取账户积分' })
      else if (result.error) setMsg({ ok: false, text: result.error })
    } catch { setMsg({ ok: false, text: '登录失败，请重试' }) }
    finally { setBusy(''); setRefreshKey((n) => n + 1) }
  }
  const signOut = async () => {
    setBusy('out')
    try { await window.api.workbuddySignOut(); setMsg({ ok: true, text: '已取消授权并清除 TokenPulse 登录；可沿用本机登录' }) }
    catch { setMsg({ ok: false, text: '清除登录失败，请重试' }) }
    finally { setBusy(''); setRefreshKey((n) => n + 1) }
  }
  const refresh = async () => {
    setBusy('refresh')
    try {
      const [account, ledger] = await Promise.all([window.api.getWorkBuddyAccount(true), window.api.getWorkBuddyLedger('today', true)])
      const error = account?.error || ledger?.error
      setMsg({ ok: !error, text: error || '账户积分与今日账本已刷新' })
    } catch { setMsg({ ok: false, text: '积分查询失败，请稍后刷新' }) }
    finally { setBusy(''); setRefreshKey((n) => n + 1) }
  }
  const waiting = busy === 'in' || st?.status === 'waiting'
  const line = st?.status === 'waiting' ? '等待浏览器授权…' : st?.error ? st.error : st?.status === 'ready' ? st.source === 'tokenpulse' ? `使用 TokenPulse 登录${st.nickname ? `（${st.nickname}）` : ''}` : '沿用本机 WorkBuddy 登录（只读）' : '请登录 WorkBuddy，或先在国内版 WorkBuddy 中登录'
  return <div className="tg-box">
    <div className="tg-row"><span className="tg-label">状态</span><span className={st?.status === 'error' || st?.status === 'expired' ? 'bad-text' : st?.status === 'ready' ? 'ok-text' : 'muted'}>{line}</span></div>
    <div className="tg-row">
      <span className="tg-label">账号</span>
      <button className="btn primary small" disabled={!!busy || waiting} onClick={() => void signIn()}>{waiting ? '等待浏览器…' : st?.loggedIn ? '重新登录 WorkBuddy' : '登录 WorkBuddy'}</button>
      {(st?.loggedIn || waiting) && <button className="btn small" disabled={busy === 'out' || busy === 'refresh'} onClick={() => void signOut()}>{waiting ? '取消授权' : '退出登录'}</button>}
      <button className="btn small" disabled={!!busy || waiting} onClick={() => void refresh()}>{busy === 'refresh' ? '读取中…' : '立即刷新'}</button>
      {msg && <span className={msg.ok ? 'ok-text' : 'bad-text'}>{msg.text}</span>}
    </div>
    <div className="set-note">通过腾讯官方页面授权，登录令牌由系统加密保存在本机，仅查询国内个人账户的积分与账本；到期后重新登录。{st?.nativeLogin ? '已检测到本机 WorkBuddy 登录，退出此处登录后会继续沿用。' : '未检测到本机 WorkBuddy 登录。'}任务执行仍使用 CLI 自身的登录。</div>
  </div>
}

function WorkBuddyRows({ s, save }: { s: Settings; save: Save }) {
  const { load } = useApp()
  const q = useTaskQueue()
  const [dir, setDir] = useState('')
  const [cli, setCli] = useState(s.workbuddyCli)
  const providers = useData(() => window.api.getWorkBuddyHarnessProviders(), [s.workbuddyEnabled, s.workbuddyHarnessProviders.join(',')], 15_000)
  useEffect(() => setCli(s.workbuddyCli), [s.workbuddyCli])
  return <>
    <Row label="启用 WorkBuddy" desc={`读取 ${load?.workbuddyFiles ?? 0} 个会话文件，独立显示 Token、缓存、积分、模型和会话；在「全部」中合并用量。`}>
      <Switch on={s.workbuddyEnabled} onChange={(workbuddyEnabled) => save({ workbuddyEnabled })} />
    </Row>
    <Row label="账户积分与账本" desc="登录后查询本账户的总积分、已用、剩余及请求明细，约每分钟更新。通过反代接入其他软件，同一账户的积分消耗也会入账；无需为每种软件设置日志目录。">
      <button className="btn small" onClick={() => void window.api.openExternal(WORKBUDDY_PLANS_URL)}>查看套餐 ↗</button>
    </Row>
    {s.workbuddyEnabled && <WorkBuddyLoginRows />}
    <div className="set-note">账户查询提供积分、模型和请求时间。本地日志补充 Token、速率、会话和工具详情；这些记录的覆盖范围取决于软件是否生成可读日志，API 参考费用与实际积分分别展示。</div>
    <Row label="任务执行入口" desc={q?.tools.workbuddy?.cli ? `已找到：${q.tools.workbuddy.cli}` : '自动寻找 codebuddy 命令或 WorkBuddy 安装包中的 CLI；也可填写启动器路径。运行内置 CLI 需要 Node.js。'}>
      <input className="input mono" placeholder="自动检测（可选填写路径）" value={cli} onChange={(e) => setCli(e.target.value)} onBlur={() => save({ workbuddyCli: cli.trim() })} />
    </Row>
    <Fold id="workbuddy-logs" label="本地日志兼容读取" current={s.workbuddyHarnessEnabled ? '原生 + 兼容客户端' : '仅原生 WorkBuddy'} desc="按需查看日志目录、客户端识别与来源映射，补充本地 Token 和会话详情。账户积分查询独立运行。">
    <Row label="读取兼容客户端日志" desc="读取 Harness 类客户端的本地会话记录。关闭后保留原生 WorkBuddy 采集与账户积分查询，不再扫描兼容客户端的会话。">
      <Switch on={s.workbuddyHarnessEnabled} onChange={(workbuddyHarnessEnabled) => save({ workbuddyHarnessEnabled })} />
    </Row>
    <div className="set-row" style={{ display: 'block' }}>
      <div className="set-label">会话日志目录</div>
      <div className="set-desc">{s.workbuddyHarnessEnabled ? '自动查找原生 WorkBuddy 和已支持的兼容客户端记录，其他数据根或会话目录可手动添加。' : '读取原生 WorkBuddy 及手动添加目录中的原生记录；兼容客户端会话暂停读取。'}</div>
      <div className="dir-list">{(load?.workbuddyDirs ?? []).map((d) => <div className="dir-item" key={d}>{d}<span className="badge">已读取</span></div>)}</div>
      {s.workbuddyDirs.map((d) => <div className="dir-item" key={d}>{d}<button className="btn ghost small" onClick={() => save({ workbuddyDirs: s.workbuddyDirs.filter((p) => p !== d) })}>移除</button></div>)}
      <div className="set-ctl"><input className="input mono" placeholder="WorkBuddy / Harness 数据根或会话目录" value={dir} onChange={(e) => setDir(e.target.value)} /><button className="btn small" disabled={!dir.trim()} onClick={() => { save({ workbuddyDirs: [...new Set([...s.workbuddyDirs, dir.trim()])] }); setDir('') }}>添加</button></div>
    </div>
    {s.workbuddyHarnessEnabled && <>
    <Row label="识别兼容日志中的 WorkBuddy" desc="逐条识别日志中保留的 WorkBuddy 响应标记（cmb-），也统计原生 workbuddy 提供商；同一提供商的其他 API 响应不会一起归入。国际版 workbuddy-ai 默认排除。">
      <Switch on={s.workbuddyHarnessAuto} onChange={(workbuddyHarnessAuto) => save({ workbuddyHarnessAuto })} />
    </Row>
    <div className="set-note">若反代改写了响应标记，可在下方手动指定其来源；开启后该提供商的全部调用计入 WorkBuddy。来源标记不能确认账户身份，官方积分只对应上方登录的账户。</div>
    {(providers ?? []).filter((id) => id !== 'workbuddy').map((id) => <Row key={id} label={id} desc="手动归属：此提供商的全部 Token、缓存、速率和会话计入 WorkBuddy；自动识别无需开启此项。">
      <Switch on={s.workbuddyHarnessProviders.includes(id)} onChange={(on) => save({ workbuddyHarnessProviders: on ? [...s.workbuddyHarnessProviders, id] : s.workbuddyHarnessProviders.filter((p) => p !== id) })} />
    </Row>)}
    </>}
    </Fold>
  </>
}

function SystemRows({ s, save, source }: { s: Settings; save: Save; source: SourceView }) {
  const { load } = useApp()
  const [dir, setDir] = useState('')
  if (source === 'workbuddy') return <>
    <UpdateRows s={s} save={save} />
    <Row label="开机自启" desc="仅在安装版中生效"><Switch on={s.launchAtLogin} onChange={(launchAtLogin) => save({ launchAtLogin })} /></Row>
    <div className="set-note">账户登录、积分查询和本地日志采集在「WorkBuddy 积分」中设置。</div>
  </>
  if (source === 'codex')
    return (
      <>
        <UpdateRows s={s} save={save} />
        <Row label="开机自启" desc="仅在安装版中生效">
          <Switch on={s.launchAtLogin} onChange={(launchAtLogin) => save({ launchAtLogin })} />
        </Row>
        <div className="set-row" style={{ display: 'block' }}>
          <div className="set-label">Codex 日志目录</div>
          <div className="set-desc">自动读取 CODEX_HOME 或 ~/.codex 下的 sessions 与 archived_sessions（只读）。</div>
          <div className="dir-list">
            {(load?.codexDirs ?? []).map((d) => (
              <div className="dir-item" key={d}>
                {d}
                <span className="badge">自动</span>
              </div>
            ))}
            {!load?.codexDirs?.length && <div className="muted">没有找到 Codex 会话目录</div>}
          </div>
        </div>
      </>
    )
  return (
    <>
      <UpdateRows s={s} save={save} />
      <Row label="开机自启" desc="仅在安装版中生效">
        <Switch on={s.launchAtLogin} onChange={(launchAtLogin) => save({ launchAtLogin })} />
      </Row>
      <Row label="历史归档" desc="Claude Code 默认只保留 30 天日志。开启后 TokenPulse 会把解析出的用量另存一份，「全部」范围不会因日志被清理而变少">
        <Switch on={s.archiveEnabled} onChange={(archiveEnabled) => save({ archiveEnabled })} />
      </Row>
      <Row label="快捷键" desc="在主窗口中可用">
        <span className="keys">
          <kbd>Ctrl</kbd>+<kbd>1</kbd>–<kbd>6</kbd> 切换页面
          <kbd>Ctrl</kbd>+<kbd>M</kbd> 悬浮窗
          <kbd>F5</kbd> 刷新额度
          <kbd>F11</kbd> 大屏
          <kbd>{hotkeyLabel(s.hotkey)}</kbd> 悬浮窗（全局）
        </span>
      </Row>
      <div className="set-row" style={{ display: 'block' }}>
        <div className="set-label">日志目录</div>
        <div className="set-desc">自动识别 CLAUDE_CONFIG_DIR、~/.claude 与 ~/.config/claude 下的 projects 目录，也可以添加其他 Claude 配置目录。</div>
        <div className="dir-list">
          {load?.dirs.map((d) => (
            <div className="dir-item" key={d}>
              {d}
              {s.extraDirs.some((x) => d.startsWith(x)) ? (
                <button className="btn ghost" style={{ padding: 2 }} title="移除" onClick={() => save({ extraDirs: s.extraDirs.filter((x) => !d.startsWith(x)) })}>
                  <IconClose />
                </button>
              ) : (
                <span className="badge">自动</span>
              )}
            </div>
          ))}
          {s.extraDirs
            .filter((x) => !load?.dirs.some((d) => d.startsWith(x)))
            .map((x) => (
              <div className="dir-item" key={x}>
                <span>
                  {x} <span className="muted">（未找到）</span>
                </span>
                <button className="btn ghost" style={{ padding: 2 }} onClick={() => save({ extraDirs: s.extraDirs.filter((y) => y !== x) })}>
                  <IconClose />
                </button>
              </div>
            ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input className="input" style={{ flex: 1 }} placeholder="例如 D:\other\.claude" value={dir} onChange={(e) => setDir(e.target.value)} />
          <button
            className="btn"
            disabled={!dir.trim()}
            onClick={() => {
              save({ extraDirs: [...s.extraDirs, dir.trim()] })
              setDir('')
            }}
          >
            添加
          </button>
        </div>
      </div>
    </>
  )
}


// ---------------------------------------------------------------- layout

/**
 * The settings groups, shown as sub-items of 设置 in the sidebar. `tool`
 * says which view shows a group: Claude-only groups hide while only Codex is
 * on view and the other way round; 全部 shows them all.
 */
export const SETTINGS_GROUPS = [
  { id: 'appearance', icon: '✦', title: '外观与动效', tool: 'both' },
  { id: 'quota', icon: '◔', title: 'Claude 额度', tool: 'claude' },
  { id: 'codex', icon: '◎', title: 'Codex 额度', tool: 'codex' },
  { id: 'workbuddy', icon: 'W', title: 'WorkBuddy 积分', tool: 'workbuddy' },
  { id: 'guard', icon: '⏸', title: '额度守卫', tool: 'claude' },
  { id: 'tasks', icon: '⏱', title: '刷新任务', tool: 'both' },
  { id: 'runaway', icon: '⚠', title: '失控与上下文', tool: 'both' },
  { id: 'notify', icon: '✉', title: '通知与 Telegram', tool: 'both' },
  { id: 'island', icon: '⬬', title: '灵动岛', tool: 'both' },
  { id: 'mini', icon: '▣', title: '悬浮窗与快捷键', tool: 'both' },
  { id: 'desktop', icon: '▤', title: '大屏与壁纸', tool: 'both' },
  { id: 'money', icon: '$', title: '预算与货币', tool: 'both' },
  { id: 'system', icon: '⚙', title: '系统与数据', tool: 'both' }
] as const
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]['id']

export interface GroupMeta {
  id: SettingsGroupId
  icon: string
  title: string
  tool: 'both' | 'claude' | 'codex' | 'workbuddy'
  /** the feature is switched on (tints the icon) */
  on: boolean
  summary: string
}

/** a group belongs on screen for this view; Codex settings stay reachable while Codex is off (to switch it on) */
function shownIn(g: { tool: string }, source: SourceView, codexOn: boolean, workbuddyOn: boolean): boolean {
  if (g.tool === 'both' || source === 'all') return true
  if (g.tool === 'codex') return source === 'codex' || !codexOn
  if (g.tool === 'workbuddy') return source === 'workbuddy' || !workbuddyOn
  return source === 'claude'
}

function useTaskQueue(): TaskQueueState | null {
  const [q, setQ] = useState<TaskQueueState | null>(null)
  useEffect(() => {
    void window.api.getTasks().then(setQ)
    return window.api.onTasks(setQ)
  }, [])
  return q
}

const label = <T extends string>(list: readonly { value: T; label: string }[], v: T) => list.find((x) => x.value === v)?.label ?? v

/** Each group on view with whether it is on and a one-line summary of its state */
export function useSettingsGroups(): GroupMeta[] {
  const { settings: s, guard, money, codexQuota, load } = useApp()
  const source = useSource()
  const q = useTaskQueue()
  if (!s) return SETTINGS_GROUPS.filter((g) => g.tool === 'both').map((g) => ({ ...g, on: false, summary: '' }))
  const mine = (q?.tasks ?? []).filter((t) => source === 'all' || (t.tool ?? 'claude') === source)
  const queued = mine.filter((t) => t.status === 'queued').length
  const running = mine.filter((t) => t.status === 'running').length
  const info: Record<SettingsGroupId, { on: boolean; summary: string }> = {
    appearance: {
      on: true,
      summary: `${s.themePack !== 'none' ? `${PACKS[s.themePack].label} · ` : ''}${label(THEMES, s.theme)} · ${ACCENTS[s.accent].label} · ${label(BACKDROPS, s.backdrop)} · 动效${label(MOTIONS, s.motion)}${s.lightFx ? ' · 光影' : ''}`
    },
    quota: {
      on: s.quotaEnabled,
      summary: [s.quotaEnabled ? label(SOURCES, s.quotaSource) : '已关闭', guard?.bridgeInstalled ? '状态栏桥接已装' : '', s.wasteAlert ? '浪费提醒' : ''].filter(Boolean).join(' · ')
    },
    codex: {
      on: s.codexEnabled,
      summary: s.codexEnabled
        ? [`${load?.codexFiles ?? 0} 个会话文件`, codexQuota?.plan ? `ChatGPT ${codexQuota.plan}` : '', s.wasteAlert ? '浪费提醒' : ''].filter(Boolean).join(' · ')
        : '未开启'
    },
    workbuddy: { on: s.workbuddyEnabled, summary: s.workbuddyEnabled ? `${load?.workbuddyFiles ?? 0} 个会话文件 · Token 与实际积分` : '未开启' },
    guard: {
      on: s.guardEnabled,
      summary: s.guardEnabled
        ? `5h ${s.guardPauseAt}% 暂停${s.guardWeeklyAt ? ` · 7d ${s.guardWeeklyAt}%` : ''}${s.guardResumeFrom && s.guardResumeTo ? ` · ${s.guardResumeFrom}–${s.guardResumeTo} 续跑` : ''}`
        : '已关闭'
    },
    tasks: {
      on: queued > 0 || running > 0,
      summary: [
        s.taskQueuePaused ? '队列已暂停' : running ? `执行中 ${running} · 排队 ${queued}` : queued ? `排队 ${queued} 个` : '队列为空',
        s.taskTerminal && q?.node ? '终端窗口' : '后台运行',
        s.taskContinue ? '接着上次对话' : ''
      ]
        .filter(Boolean)
        .join(' · ')
    },
    runaway: {
      on: s.runawayDetect || s.contextAlert,
      summary: [
        s.runawayDetect ? `失控检测 ${{ low: '宽松', medium: '标准', high: '灵敏' }[s.runawaySensitivity]} · ${s.runawayAction === 'pause' ? '提醒并暂停' : '只提醒'}` : '失控检测关闭',
        s.contextAlert ? (s.contextAuto ? '上下文自动提醒' : `上下文 ${s.contextWarnK}k 提醒`) : ''
      ]
        .filter(Boolean)
        .join(' · ')
    },
    notify: {
      on: s.sound || s.telegramEnabled,
      summary:
        [s.sound ? '音效' : '', s.telegramEnabled ? `Telegram${s.telegramCommands ? ' · 遥控' : ''}${s.reportTime ? ` · 晚报 ${s.reportTime}` : ''}` : ''].filter(Boolean).join(' · ') || '只有桌面通知'
    },
    island: { on: s.island, summary: s.island ? '已开启' : '已关闭' },
    mini: {
      on: s.showMini,
      summary: `${s.showMini ? `${label(MINI_MODES, s.miniMode)} · ${label(MINI_SCALES, String(s.miniScale))}` : '悬浮窗关闭'}${s.globalHotkey ? ` · ${hotkeyLabel(s.hotkey)}` : ''}`
    },
    desktop: { on: s.wallpaper, summary: s.wallpaper ? '动态壁纸开启 · 大屏 F11' : '大屏 F11' },
    money: {
      on: !!(s.dailyBudget || s.monthlyBudget),
      summary: [s.currency, s.dailyBudget ? `日预算 ${money(s.dailyBudget)}` : '', s.monthlyBudget ? `月预算 ${money(s.monthlyBudget)}` : ''].filter(Boolean).join(' · ')
    },
    system: {
      on: s.archiveEnabled,
      summary: [s.launchAtLogin ? '开机自启' : '', s.archiveEnabled ? '历史归档' : '', s.extraDirs.length ? `额外目录 ${s.extraDirs.length}` : ''].filter(Boolean).join(' · ') || '默认'
    }
  }
  return SETTINGS_GROUPS.filter((g) => shownIn(g, source, s.codexEnabled, s.workbuddyEnabled)).map((g) => ({ ...g, icon: g.id === 'money' && s.currency === 'CNY' ? '¥' : g.icon, ...info[g.id] }))
}

function GroupBody({ id, s, save }: { id: SettingsGroupId; s: Settings; save: Save }) {
  const q = useTaskQueue()
  const source = useSource()
  switch (id) {
    case 'appearance':
      return <AppearanceRows s={s} save={save} />
    case 'quota':
      return <QuotaRows s={s} save={save} />
    case 'workbuddy':
      return <WorkBuddyRows s={s} save={save} />
    case 'codex':
      return <CodexRows s={s} save={save} />
    case 'guard':
      return <GuardRows s={s} save={save} />
    case 'tasks':
      return <TaskRows s={s} save={save} q={q} source={source} />
    case 'runaway':
      return <RunawayRows s={s} save={save} source={source} />
    case 'notify':
      return <NotifyRows s={s} save={save} source={source} />
    case 'island':
      return <IslandRows s={s} save={save} />
    case 'mini':
      return <MiniRows s={s} save={save} />
    case 'desktop':
      return <DesktopRows s={s} save={save} />
    case 'money':
      return <MoneyRows s={s} save={save} source={source} />
    case 'system':
      return <SystemRows s={s} save={save} source={source} />
  }
}

/** One settings group; the sidebar picks which */
export function SettingsPage({ group, onGroup }: { group: SettingsGroupId; onGroup: (g: SettingsGroupId) => void }) {
  const { settings, saveSettings } = useApp()
  const groups = useSettingsGroups()
  if (!settings) return null
  const save: Save = (p) => void saveSettings(p)
  const i = Math.max(0, groups.findIndex((g) => g.id === group))
  const g = groups[i]
  const prev = groups[i - 1]
  const next = groups[i + 1]
  return (
    <>
      <div className="page-head">
        <div className="set-page-head">
          <span className={`set-group-icon big${g.on ? ' on' : ''}`}>{g.icon}</span>
          <div>
            <h1 className="page-title">{g.title}</h1>
            <div className="page-sub">{g.summary}</div>
          </div>
        </div>
        <span className="muted set-crumb">
          设置 · {i + 1} / {groups.length}
        </span>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={group}
          className="card set-section"
          initial={{ opacity: 0, x: 18 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -12 }}
          transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
        >
          <GroupBody id={g.id} s={settings} save={save} />
        </motion.div>
      </AnimatePresence>
      <div className="set-pager">
        {prev ? (
          <button className="btn ghost" onClick={() => onGroup(prev.id)}>
            ← {prev.icon} {prev.title}
          </button>
        ) : (
          <span />
        )}
        {next && (
          <button className="btn ghost" onClick={() => onGroup(next.id)}>
            {next.icon} {next.title} →
          </button>
        )}
      </div>
      <div className="set-foot muted">设置保存在本机，不会上传到任何地方。</div>
    </>
  )
}
