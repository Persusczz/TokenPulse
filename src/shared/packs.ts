import type { AccentKey } from './accents'
import type { BackdropStyle, ThemePack, ThemeSetting } from './types'

/**
 * Theme packs: one click sets the colours (styles.css, [data-pack]), the
 * backdrop, the light/dark theme and the fonts. Accent is the closest preset,
 * for the parts that read it directly. `entrance` names the pack's own
 * entrance and page-turn effect (components/Transitions.tsx, by backdrop).
 */
export const PACKS: Record<ThemePack, { label: string; desc: string; theme: ThemeSetting; backdrop: BackdropStyle; accent: AccentKey; swatch: string[]; font: string; entrance: string }> = {
  none: {
    label: 'Claude 默认',
    desc: '暖白与陶土色、衬线标题、流光背景',
    theme: 'system',
    backdrop: 'flow',
    accent: 'clay',
    swatch: ['#faf9f5', '#d97757', '#3d3d3a'],
    font: "'Source Serif 4 Variable', serif",
    entrance: '光波'
  },
  daylight: {
    label: '昼夜',
    desc: '山湖的一整天，跟着真实的太阳和节气走：清晨热气球升空、晨雾漫过湖面，正午飞机拉出航迹、鹰在天上盘旋、帆船过湖，偶尔一阵过云雨后挂起彩虹；傍晚晚霞与蝙蝠，深夜星河、卫星和萤火，用量火热时拉起极光。春花、夏絮、秋叶、冬雪随季节飘落，界面颜色随天色变化。点侧栏的天色钟，40 秒看完一天',
    theme: 'dark',
    backdrop: 'daylight',
    accent: 'clay',
    swatch: ['#226ed0', '#ffcf4d', '#ff7f3e'],
    font: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    entrance: '日升月落'
  },
  mystic: {
    label: '诡秘世界',
    desc: '绯红之月下的维多利亚雾都：月亮外一圈封印法阵缓缓转动，灰雾一层层漫过街巷，煤气灯在雾里明灭，塔罗牌从雾中浮起、翻面，渡鸦掠过月面；侧边栏的钟楼走着真实的时间。新用量翻开一张金光闪闪的塔罗牌，钟声敲响',
    theme: 'dark',
    backdrop: 'mystic',
    accent: 'sakura',
    swatch: ['#0c0810', '#c4283c', '#c9a45c'],
    font: "'Palatino Linotype', 'Book Antiqua', 'Source Serif 4 Variable', serif",
    entrance: '灰雾涌起'
  },
  cyber: {
    label: '赛博朋克',
    desc: '雨夜的不夜城：三层摩天楼的窗格明明灭灭，霓虹招牌竖着挂下侧边栏，探照灯扫过霓虹染红的雾霾，飞行车拖着光轨穿梭，中央大楼顶上的全息广告牌转着线框体、打出广告词。新用量让广告牌信号故障，打出这批 Token，一辆巡逻车呼啸而过',
    theme: 'dark',
    backdrop: 'cyber',
    accent: 'clay',
    swatch: ['#07060e', '#fcee0a', '#00f0ff'],
    font: "Bahnschrift, 'Segoe UI', sans-serif",
    entrance: '信号故障'
  },
  xianxia: {
    label: '云海仙山',
    desc: '一轮皓月下的云海：石峰浮在流动的云层上微微起伏，侧边栏悬着一座带亭子和飞瀑的浮岛，仙鹤排成一行从月前飞过，灵光点点上升。每批新用量划过一道御剑飞行的剑光，用量大时三剑齐飞',
    theme: 'dark',
    backdrop: 'xianxia',
    accent: 'mint',
    swatch: ['#0a1622', '#4fd1b5', '#e9c46a'],
    font: "KaiTi, STKaiti, 'Source Serif 4 Variable', serif",
    entrance: '御剑飞过'
  },
  koi: {
    label: '锦鲤池',
    desc: '俯瞰一方锦鲤池：红白、大正三色、黄金、丹顶等八种锦鲤摆着身子和鳍游动，水底卵石上光纹流动，睡莲和荷花缓缓漂移，花瓣浮在水面。每批新用量撒下一把鱼食，锦鲤争相游来；用量大时游来一条金色锦鲤',
    theme: 'dark',
    backdrop: 'koi',
    accent: 'clay',
    swatch: ['#0b3c39', '#ff6b4a', '#ff9ec4'],
    font: "'Source Serif 4 Variable', KaiTi, serif",
    entrance: '锦鲤游过'
  },
  ukiyo: {
    label: '浮世绘',
    desc: '木版画的海：天顶一抹普鲁士蓝、一轮红日、淡淡的霞带，远处雪山，一排排浪头翻着白沫，小船随浪起伏，千鸟成行飞过；侧边栏一道巨浪涨起、卷起浪爪、拍碎，周而复始。新用量从浪尖甩出一片浪花。深色模式是夜版画',
    theme: 'light',
    backdrop: 'ukiyo',
    accent: 'ocean',
    swatch: ['#efe2c4', '#1f3b63', '#cf4a33'],
    font: "'Yu Mincho', 'Source Serif 4 Variable', SimSun, serif",
    entrance: '浪花拍岸'
  },
  pixel: {
    label: '像素冒险',
    desc: '8-bit 的世界：抖动渐变的天空随时辰变成白天、黄昏或夜晚，方块云、雪山、松林和草地层层视差滚动；标题旁浮着一座砖块小岛，小小冒险家在金币间跑跳。每批新用量顶开一个问号砖，蹦出金币和这批 Token 数',
    theme: 'dark',
    backdrop: 'pixel',
    accent: 'clay',
    swatch: ['#1b1030', '#fcbc3c', '#2ec4b6'],
    font: "'Cascadia Code', Consolas, monospace",
    entrance: '像素过场'
  },
  claude: {
    label: 'Claude 暖光',
    desc: '暖炭底色上的陶土与象牙白，衬线标题；柔和的色块像 Claude 的插画一样缓缓漂移，手绘线条和小星芒点缀其间',
    theme: 'dark',
    backdrop: 'claude',
    accent: 'clay',
    swatch: ['#1c1a17', '#d97757', '#f0ebe0'],
    font: "'Source Serif 4 Variable', serif",
    entrance: '星芒绽放'
  },
  codex: {
    label: 'Codex 夜终端',
    desc: '近黑的终端底色、蓝紫与冰青，等宽数字；点阵、顶上漂移的光和若隐若现的节点网络，命令行偶尔自己敲出一行',
    theme: 'dark',
    backdrop: 'codex',
    accent: 'wisteria',
    swatch: ['#0a0c12', '#5b6cff', '#9ee7ff'],
    font: "'Cascadia Code', Consolas, monospace",
    entrance: '逐行扫描'
  },
  astral: {
    label: '星图',
    desc: '深蓝星空上金色的天球网格和十二星座环，今天的星座画在正中，用量越多点亮的星越多；新用量划过一颗流星',
    theme: 'dark',
    backdrop: 'astral',
    accent: 'wisteria',
    swatch: ['#0a1330', '#d6b66e', '#f3e7c4'],
    font: "'Source Serif 4 Variable', serif",
    entrance: '星座连线'
  },
  orrery: {
    label: '行星仪',
    desc: '黄铜色的太阳系仪：八大行星停在它们今天真实所在的位置，轨道上流过微光，小行星带缓缓转动；新用量从地球发射一枚探测器',
    theme: 'dark',
    backdrop: 'orrery',
    accent: 'clay',
    swatch: ['#0d0b14', '#c9a25e', '#e9dcc0'],
    font: "'Source Serif 4 Variable', serif",
    entrance: '行星归位'
  },
  lunar: {
    label: '月夜',
    desc: '海上的夜：月亮是今晚真实的月相，银色的月光路在海面上闪烁，薄云从月前飘过；新用量划过一颗流星，海面亮起一道波光',
    theme: 'dark',
    backdrop: 'lunar',
    accent: 'ocean',
    swatch: ['#0b1424', '#dfe6f2', '#7f9cc7'],
    font: "'Source Serif 4 Variable', serif",
    entrance: '月升'
  },
  eclipse: {
    label: '日冕',
    desc: '日全食的一刻：黑色的月轮外，珍珠白的日冕丝缕伸展，边缘跳着粉红的日珥，地平线一圈都是晚霞；新用量闪出一枚钻石环',
    theme: 'dark',
    backdrop: 'eclipse',
    accent: 'clay',
    swatch: ['#07080d', '#f4efe6', '#ff7a59'],
    font: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    entrance: '日全食'
  },
  trails: {
    label: '星轨',
    desc: '长曝光的夜空：星星绕着天极画出彩色的同心圆弧，越画越长，山脊上一顶亮着灯的帐篷；新用量划过一颗带余迹的火流星',
    theme: 'dark',
    backdrop: 'trails',
    accent: 'ocean',
    swatch: ['#060a18', '#8fb8ff', '#ffd27a'],
    font: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    entrance: '星轨划过'
  },
  rain: {
    label: '雨夜',
    desc: '雨夜的窗：玻璃外是失焦的城市灯光，雨珠在玻璃上凝结、汇合、拖着水痕滑落；用量越多雨越大，新用量远处亮起一道闪电',
    theme: 'dark',
    backdrop: 'rain',
    accent: 'clay',
    swatch: ['#0b0d18', '#ff9e5e', '#5fd4ff'],
    font: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    entrance: '雨帘落下'
  },
  firefly: {
    label: '萤火',
    desc: '夏夜的林间：层层树影和低低的雾，萤火虫一明一暗地游荡，倒映在水面上；用量越多萤火越多，新用量从草丛里飞起一群',
    theme: 'dark',
    backdrop: 'firefly',
    accent: 'mint',
    swatch: ['#07120d', '#d9ff7a', '#5c8f6a'],
    font: "'Source Serif 4 Variable', serif",
    entrance: '萤火升起'
  },
  lava: {
    label: '熔岩灯',
    desc: '复古熔岩灯：橙红到洋红的蜡团在暖紫底色里升起、冷却、下沉、彼此融合；用量越多越热，新用量从灯底涌起一大团',
    theme: 'dark',
    backdrop: 'lava',
    accent: 'sakura',
    swatch: ['#1a0b1e', '#ff6a3c', '#ff2d7a'],
    font: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    entrance: '熔岩涌起'
  },
  crystal: {
    label: '冰晶',
    desc: '低多边形的冰面：一片片晶面随着转动的光明暗变化，偶尔折出一道彩虹；新用量在冰面上荡开一圈光',
    theme: 'dark',
    backdrop: 'crystal',
    accent: 'ocean',
    swatch: ['#071428', '#7fd8ff', '#e6f7ff'],
    font: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    entrance: '晶面折光'
  },
  matrix: {
    label: '数字雨',
    desc: '黑客帝国式的绿色代码雨：一列列字符落下，头部发亮、尾巴渐暗、字符不停变换；用量越多雨越密，新用量点亮一片从天而降的亮列',
    theme: 'dark',
    backdrop: 'matrix',
    accent: 'mint',
    swatch: ['#020a05', '#3dff7a', '#c8ffd8'],
    font: "'Cascadia Code', Consolas, monospace",
    entrance: '代码雨落'
  },
  fireworks: {
    label: '烟花',
    desc: '城市夜空的烟花：礼花升空、绽放、拖着光尾落下，楼宇的窗户亮着；用量越多放得越勤，每批新用量放一发烟花，Token 越多越大',
    theme: 'dark',
    backdrop: 'fireworks',
    accent: 'clay',
    swatch: ['#070a1a', '#ffb347', '#ff4f8b'],
    font: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    entrance: '烟花绽放'
  },
  lantern: {
    label: '天灯',
    desc: '湖面上空的孔明灯：暖黄的纸灯摇摇晃晃地升上夜空，火苗闪动，倒影落在水里；用量越多灯越多，新用量从岸边放飞几盏',
    theme: 'dark',
    backdrop: 'lantern',
    accent: 'clay',
    swatch: ['#0b0f24', '#ffb35c', '#ffe1a8'],
    font: "'Source Serif 4 Variable', KaiTi, serif",
    entrance: '天灯升起'
  },
  bauhaus: {
    label: '包豪斯',
    desc: '包豪斯海报：米色纸上红、蓝、黄、黑的圆、半圆、三角和条纹组成网格，时不时咔哒转上四分之一圈；新用量让几块弹一下',
    theme: 'light',
    backdrop: 'bauhaus',
    accent: 'clay',
    swatch: ['#f4efe4', '#d6402e', '#1f4e9c'],
    font: "Bahnschrift, 'Segoe UI', sans-serif",
    entrance: '几何拼装'
  },
  sakura: {
    label: '樱花',
    desc: '淡粉的天空和远山，樱花枝从两角伸进来，花瓣翻转着飘落；新用量摇下一阵花雨。深色模式是月下夜樱',
    theme: 'light',
    backdrop: 'sakura',
    accent: 'sakura',
    swatch: ['#fdf3f6', '#e0607e', '#5b3b33'],
    font: "'Source Serif 4 Variable', serif",
    entrance: '花瓣飞舞'
  },
  dune: {
    label: '沙丘',
    desc: '黄昏的沙丘层层叠叠，脊线被夕阳照亮，风把沙从脊上吹起；新用量卷起一阵风沙。深色模式是沙漠星夜',
    theme: 'light',
    backdrop: 'dune',
    accent: 'clay',
    swatch: ['#ffd9a8', '#c96f3f', '#4a2a1a'],
    font: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    entrance: '风沙掠过'
  },
  paper: {
    label: '纸笺手账',
    desc: '带纤维的暖色纸和点阵格，阳光从窗外慢慢移过纸面，角落一圈咖啡渍；每批新用量用铅笔在页边画一个小涂鸦',
    theme: 'light',
    backdrop: 'paper',
    accent: 'clay',
    swatch: ['#f7f1e3', '#c0533f', '#3a352e'],
    font: "'Source Serif 4 Variable', KaiTi, serif",
    entrance: '翻页'
  },
  neon: {
    label: '赛博霓虹',
    desc: '午夜紫底上的洋红与青色霓虹，落日条纹、线框山脉和奔向你的网格地平线，等宽方正的数字',
    theme: 'dark',
    backdrop: 'neon',
    accent: 'sakura',
    swatch: ['#0a0612', '#ff2bd6', '#21e6ff'],
    font: "Bahnschrift, 'Segoe UI', sans-serif",
    entrance: '故障闪烁'
  },
  borealis: {
    label: '北欧极光',
    desc: '极夜雪山上空摇曳的绿紫光幕，冷冽的青色点缀，纤细的无衬线字',
    theme: 'dark',
    backdrop: 'borealis',
    accent: 'mint',
    swatch: ['#07131a', '#3ee6a8', '#b48cff'],
    font: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    entrance: '光幕拂过'
  },
  ink: {
    label: '墨水纸本',
    desc: '宣纸底色、层叠的水墨远山与飞鸟，楷体标题，朱砂印泥色；新用量像一滴墨晕开',
    theme: 'light',
    backdrop: 'ink',
    accent: 'clay',
    swatch: ['#f3ede0', '#b8322a', '#1d1a16'],
    font: 'KaiTi, STKaiti, serif',
    entrance: '墨迹晕开'
  },
  abyss: {
    label: '深海',
    desc: '海面透下的光束、上浮的气泡、发光的浮游生物和水母，深蓝里的一抹荧光青',
    theme: 'dark',
    backdrop: 'abyss',
    accent: 'ocean',
    swatch: ['#031423', '#2ec5ff', '#7dffe6'],
    font: "'Segoe UI Variable Display', 'Segoe UI', sans-serif",
    entrance: '气泡上浮'
  }
}

export const PACK_KEYS = Object.keys(PACKS) as ThemePack[]
