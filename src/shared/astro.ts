/**
 * Low-precision astronomy for the celestial backdrops and the sunrise / sunset
 * theme: the sun and the moon's phase (after SunCalc, with Meeus's main lunar
 * terms) and the planets from JPL's approximate Keplerian elements (good to a
 * fraction of a degree, 1800–2050). Times are epoch milliseconds, angles in
 * degrees unless the name says otherwise.
 */

const RAD = Math.PI / 180
const DAY = 86_400_000
const J1970 = 2440588
const J2000 = 2451545
const OBLIQ = RAD * 23.4397

const toJulian = (t: number) => t / DAY - 0.5 + J1970
const fromJulian = (j: number) => (j + 0.5 - J1970) * DAY
const toDays = (t: number) => toJulian(t) - J2000
const norm360 = (a: number) => ((a % 360) + 360) % 360

export interface Place {
  lat: number
  lon: number
  name: string
}

// ---------------------------------------------------------------- places

/** cities offered in settings; the first match by time zone is the default */
export const CITIES: (Place & { tz?: string[] })[] = [
  { name: '北京', lat: 39.9, lon: 116.4, tz: ['Asia/Shanghai', 'Asia/Chongqing', 'Asia/Harbin', 'Asia/Urumqi', 'PRC'] },
  { name: '上海', lat: 31.23, lon: 121.47 },
  { name: '广州', lat: 23.13, lon: 113.26 },
  { name: '深圳', lat: 22.54, lon: 114.06 },
  { name: '杭州', lat: 30.27, lon: 120.15 },
  { name: '南京', lat: 32.06, lon: 118.8 },
  { name: '苏州', lat: 31.3, lon: 120.59 },
  { name: '成都', lat: 30.57, lon: 104.07 },
  { name: '重庆', lat: 29.56, lon: 106.55 },
  { name: '武汉', lat: 30.59, lon: 114.31 },
  { name: '西安', lat: 34.34, lon: 108.94 },
  { name: '天津', lat: 39.13, lon: 117.2 },
  { name: '长沙', lat: 28.23, lon: 112.94 },
  { name: '郑州', lat: 34.75, lon: 113.63 },
  { name: '青岛', lat: 36.07, lon: 120.38 },
  { name: '厦门', lat: 24.48, lon: 118.09 },
  { name: '沈阳', lat: 41.8, lon: 123.43 },
  { name: '哈尔滨', lat: 45.8, lon: 126.53 },
  { name: '昆明', lat: 25.04, lon: 102.71 },
  { name: '拉萨', lat: 29.65, lon: 91.14 },
  { name: '乌鲁木齐', lat: 43.83, lon: 87.62 },
  { name: '香港', lat: 22.32, lon: 114.17, tz: ['Asia/Hong_Kong', 'Asia/Macau'] },
  { name: '台北', lat: 25.03, lon: 121.57, tz: ['Asia/Taipei'] },
  { name: '新加坡', lat: 1.35, lon: 103.82, tz: ['Asia/Singapore', 'Asia/Kuala_Lumpur'] },
  { name: '东京', lat: 35.68, lon: 139.69, tz: ['Asia/Tokyo'] },
  { name: '首尔', lat: 37.57, lon: 126.98, tz: ['Asia/Seoul'] },
  { name: '伦敦', lat: 51.51, lon: -0.13, tz: ['Europe/London'] },
  { name: '巴黎', lat: 48.86, lon: 2.35, tz: ['Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'Europe/Rome'] },
  { name: '纽约', lat: 40.71, lon: -74.01, tz: ['America/New_York', 'America/Toronto'] },
  { name: '旧金山', lat: 37.77, lon: -122.42, tz: ['America/Los_Angeles', 'America/Vancouver'] },
  { name: '悉尼', lat: -33.87, lon: 151.21, tz: ['Australia/Sydney', 'Australia/Melbourne'] }
]

/** where the sky is drawn for: the chosen place, else a city in this time zone, else a guess from the UTC offset */
export function placeOf(chosen: Place | null | undefined, tz = safeZone(), offsetMin = -new Date().getTimezoneOffset()): Place {
  if (chosen) return chosen
  const c = CITIES.find((x) => x.tz?.includes(tz))
  if (c) return { name: c.name, lat: c.lat, lon: c.lon }
  return { name: `UTC${offsetMin >= 0 ? '+' : '−'}${Math.abs(offsetMin / 60)} 时区`, lat: 35, lon: Math.max(-180, Math.min(180, offsetMin / 4)) }
}

function safeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? ''
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------- coordinates

const rightAscension = (l: number, b: number) => Math.atan2(Math.sin(l) * Math.cos(OBLIQ) - Math.tan(b) * Math.sin(OBLIQ), Math.cos(l))
const declination = (l: number, b: number) => Math.asin(Math.sin(b) * Math.cos(OBLIQ) + Math.cos(b) * Math.sin(OBLIQ) * Math.sin(l))
/** radians, from north through east */
const azimuthN = (H: number, phi: number, dec: number) => Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi)) + Math.PI
const altitudeR = (H: number, phi: number, dec: number) => Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H))
const sidereal = (d: number, lw: number) => RAD * (280.16 + 360.9856235 * d) - lw

export interface Horizontal {
  /** degrees above the horizon */
  alt: number
  /** degrees from north through east */
  az: number
}

// ---------------------------------------------------------------- sun

const solarMeanAnomaly = (d: number) => RAD * (357.5291 + 0.98560028 * d)
function eclipticLongitude(M: number): number {
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M))
  return M + C + RAD * 102.9372 + Math.PI
}
function sunCoords(d: number) {
  const L = eclipticLongitude(solarMeanAnomaly(d))
  return { dec: declination(L, 0), ra: rightAscension(L, 0), lon: L }
}

/** the sun's place in the sky */
export function sunPosition(t: number, place: Place): Horizontal & { ra: number; dec: number; lon: number } {
  const d = toDays(t)
  const c = sunCoords(d)
  const lw = RAD * -place.lon
  const phi = RAD * place.lat
  const H = sidereal(d, lw) - c.ra
  return { alt: altitudeR(H, phi, c.dec) / RAD, az: norm360(azimuthN(H, phi, c.dec) / RAD), ra: norm360(c.ra / RAD) / 15, dec: c.dec / RAD, lon: norm360(c.lon / RAD) }
}

export interface SunTimes {
  /** null when the sun stays up or down all day (polar day / night) */
  rise: number | null
  set: number | null
  noon: number
  /** civil twilight: the sun 6° below the horizon */
  dawn: number | null
  dusk: number | null
  /** golden hour starts (evening) / ends (morning): the sun 6° above */
  goldenEve: number | null
  goldenMorn: number | null
}

/** sunrise, sunset and twilight for the local day around t */
export function sunTimes(t: number, place: Place): SunTimes {
  const lw = RAD * -place.lon
  const phi = RAD * place.lat
  const d = toDays(t)
  const J0 = 0.0009
  const n = Math.round(d - J0 - lw / (2 * Math.PI))
  const ds = J0 + lw / (2 * Math.PI) + n
  const M = solarMeanAnomaly(ds)
  const L = eclipticLongitude(M)
  const dec = declination(L, 0)
  const transit = (x: number) => J2000 + x + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L)
  const Jnoon = transit(ds)
  const pair = (h: number): [number | null, number | null] => {
    const c = (Math.sin(h * RAD) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec))
    if (c < -1 || c > 1) return [null, null]
    const w = Math.acos(c)
    const Jset = transit(J0 + (w + lw) / (2 * Math.PI) + n)
    return [fromJulian(Jnoon - (Jset - Jnoon)), fromJulian(Jset)]
  }
  const [rise, set] = pair(-0.833)
  const [dawn, dusk] = pair(-6)
  const [goldenMorn, goldenEve] = pair(6)
  return { rise, set, noon: fromJulian(Jnoon), dawn, dusk, goldenEve, goldenMorn }
}

// ---------------------------------------------------------------- moon

/** the moon with its largest periodic terms (Meeus), good to a few tenths of a degree */
function moonCoords(d: number) {
  const L = RAD * (218.316 + 13.176396 * d)
  const M = RAD * (134.963 + 13.064993 * d)
  const F = RAD * (93.272 + 13.22935 * d)
  const D = RAD * (297.85 + 12.190749 * d)
  const S = solarMeanAnomaly(d)
  const s = Math.sin
  const l =
    L +
    RAD *
      (6.289 * s(M) +
        1.274 * s(2 * D - M) +
        0.658 * s(2 * D) -
        0.186 * s(S) -
        0.059 * s(2 * D - 2 * M) -
        0.057 * s(2 * D - S - M) +
        0.053 * s(2 * D + M) +
        0.046 * s(2 * D - S) +
        0.041 * s(M - S) -
        0.035 * s(D) -
        0.031 * s(S + M))
  const b = RAD * (5.128 * s(F) + 0.281 * s(M + F) + 0.278 * s(M - F) + 0.173 * s(2 * D - F))
  const dist = 385001 - 20905 * Math.cos(M) - 3699 * Math.cos(2 * D - M) - 2956 * Math.cos(2 * D)
  return { ra: rightAscension(l, b), dec: declination(l, b), dist }
}

/** the moon's place in the sky */
export function moonPosition(t: number, place: Place): Horizontal {
  const d = toDays(t)
  const c = moonCoords(d)
  const H = sidereal(d, RAD * -place.lon) - c.ra
  const phi = RAD * place.lat
  return { alt: altitudeR(H, phi, c.dec) / RAD, az: norm360(azimuthN(H, phi, c.dec) / RAD) }
}

export interface MoonPhase {
  /** 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter */
  phase: number
  /** lit share of the disc, 0–1 */
  fraction: number
  /** midpoint angle of the lit limb, radians (from north, toward east), for drawing */
  angle: number
  /** days since new moon */
  age: number
  name: string
  emoji: string
}

const SYNODIC = 29.530588853

export function moonPhase(t: number): MoonPhase {
  const d = toDays(t)
  const s = sunCoords(d)
  const m = moonCoords(d)
  const sdist = 149598000
  const phi = Math.acos(Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra))
  const inc = Math.atan2(sdist * Math.sin(phi), m.dist - sdist * Math.cos(phi))
  const angle = Math.atan2(Math.cos(s.dec) * Math.sin(s.ra - m.ra), Math.sin(s.dec) * Math.cos(m.dec) - Math.cos(s.dec) * Math.sin(m.dec) * Math.cos(s.ra - m.ra))
  const phase = 0.5 + (0.5 * inc * (angle < 0 ? -1 : 1)) / Math.PI
  const { name, emoji } = phaseName(phase)
  return { phase, fraction: (1 + Math.cos(inc)) / 2, angle, age: phase * SYNODIC, name, emoji }
}

function phaseName(p: number): { name: string; emoji: string } {
  const NAMES: [number, string, string][] = [
    [0.033, '新月', '🌑'],
    [0.216, '蛾眉月', '🌒'],
    [0.283, '上弦月', '🌓'],
    [0.466, '盈凸月', '🌔'],
    [0.533, '满月', '🌕'],
    [0.716, '亏凸月', '🌖'],
    [0.783, '下弦月', '🌗'],
    [0.966, '残月', '🌘'],
    [1.01, '新月', '🌑']
  ]
  const hit = NAMES.find(([lim]) => p < lim) ?? NAMES[0]
  return { name: hit[1], emoji: hit[2] }
}

// ---------------------------------------------------------------- planets

type Elements = [a: number, e: number, I: number, L: number, peri: number, node: number]
/** JPL approximate elements at J2000 and their rates per century (Standish, table 1) */
const ELEMENTS: Record<string, [Elements, Elements]> = {
  mercury: [
    [0.38709927, 0.20563593, 7.00497902, 252.2503235, 77.45779628, 48.33076593],
    [0.00000037, 0.00001906, -0.00594749, 149472.67411175, 0.16047689, -0.12534081]
  ],
  venus: [
    [0.72333566, 0.00677672, 3.39467605, 181.9790995, 131.60246718, 76.67984255],
    [0.0000039, -0.00004107, -0.0007889, 58517.81538729, 0.00268329, -0.27769418]
  ],
  earth: [
    [1.00000261, 0.01671123, -0.00001531, 100.46457166, 102.93768193, 0],
    [0.00000562, -0.00004392, -0.01294668, 35999.37244981, 0.32327364, 0]
  ],
  mars: [
    [1.52371034, 0.0933941, 1.84969142, -4.55343205, -23.94362959, 49.55953891],
    [0.00001847, 0.00007882, -0.00813131, 19140.30268499, 0.44441088, -0.29257343]
  ],
  jupiter: [
    [5.202887, 0.04838624, 1.30439695, 34.39644051, 14.72847983, 100.47390909],
    [-0.00011607, -0.00013253, -0.00183714, 3034.74612775, 0.21252668, 0.20469106]
  ],
  saturn: [
    [9.53667594, 0.05386179, 2.48599187, 49.95424423, 92.59887831, 113.66242448],
    [-0.0012506, -0.00050991, 0.00193609, 1222.49362201, -0.41897216, -0.28867794]
  ],
  uranus: [
    [19.18916464, 0.04725744, 0.77263783, 313.23810451, 170.9542763, 74.01692503],
    [-0.00196176, -0.00004397, -0.00242939, 428.48202785, 0.40805281, 0.04240589]
  ],
  neptune: [
    [30.06992276, 0.00859048, 1.77004347, -55.12002969, 44.96476227, 131.78422574],
    [0.00026291, 0.00005105, 0.00035372, 218.45945325, -0.32241464, -0.01262724]
  ]
}

export type PlanetKey = 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune'

export const PLANETS: { key: PlanetKey | 'earth'; name: string; color: string; size: number; period: number }[] = [
  { key: 'mercury', name: '水星', color: '#b7a99a', size: 2.2, period: 87.97 },
  { key: 'venus', name: '金星', color: '#f3d9a4', size: 3.4, period: 224.7 },
  { key: 'earth', name: '地球', color: '#6fb6ff', size: 3.5, period: 365.26 },
  { key: 'mars', name: '火星', color: '#e2734a', size: 2.8, period: 686.98 },
  { key: 'jupiter', name: '木星', color: '#e0b98a', size: 6.5, period: 4332.6 },
  { key: 'saturn', name: '土星', color: '#e8d29a', size: 5.6, period: 10759 },
  { key: 'uranus', name: '天王星', color: '#9fe3e6', size: 4.2, period: 30687 },
  { key: 'neptune', name: '海王星', color: '#6f8dff', size: 4.1, period: 60190 }
]

/** heliocentric ecliptic position in AU (x toward the vernal equinox) */
export function heliocentric(key: PlanetKey | 'earth', t: number): { x: number; y: number; z: number; lon: number; r: number } {
  const T = (toJulian(t) - J2000) / 36525
  const [base, rate] = ELEMENTS[key]
  const [a, e, I, L, peri, node] = base.map((v, i) => v + rate[i] * T) as Elements
  const w = (peri - node) * RAD
  const O = node * RAD
  const inc = I * RAD
  const M = norm360(L - peri) * RAD
  let E = M + e * Math.sin(M)
  for (let i = 0; i < 8; i++) E -= (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E))
  const xp = a * (Math.cos(E) - e)
  const yp = a * Math.sqrt(1 - e * e) * Math.sin(E)
  const x = (Math.cos(w) * Math.cos(O) - Math.sin(w) * Math.sin(O) * Math.cos(inc)) * xp + (-Math.sin(w) * Math.cos(O) - Math.cos(w) * Math.sin(O) * Math.cos(inc)) * yp
  const y = (Math.cos(w) * Math.sin(O) + Math.sin(w) * Math.cos(O) * Math.cos(inc)) * xp + (-Math.sin(w) * Math.sin(O) + Math.cos(w) * Math.cos(O) * Math.cos(inc)) * yp
  const z = Math.sin(w) * Math.sin(inc) * xp + Math.cos(w) * Math.sin(inc) * yp
  return { x, y, z, lon: norm360(Math.atan2(y, x) / RAD), r: Math.hypot(x, y, z) }
}

/** distances from the Earth (km) for the token journey */
export const JOURNEY: { name: string; km: number; note: string }[] = [
  { name: '国际空间站', km: 408, note: '近地轨道' },
  { name: '月球', km: 384_400, note: '38.4 万公里' },
  { name: '金星', km: 41_400_000, note: '最近时约 4 千万公里' },
  { name: '火星', km: 78_340_000, note: '平均冲日距离' },
  { name: '太阳', km: 149_600_000, note: '1 个天文单位' },
  { name: '木星', km: 628_730_000, note: '冲日时约 6.3 亿公里' },
  { name: '土星', km: 1_275_000_000, note: '冲日时约 12.8 亿公里' },
  { name: '天王星', km: 2_723_950_000, note: '冲日时约 27 亿公里' },
  { name: '海王星', km: 4_351_400_000, note: '冲日时约 43.5 亿公里' },
  { name: '冥王星', km: 5_900_000_000, note: '约 59 亿公里' },
  { name: '旅行者 1 号', km: 25_000_000_000, note: '人类飞得最远的探测器' },
  { name: '比邻星', km: 40_140_000_000_000, note: '离太阳最近的恒星，4.24 光年' }
]
