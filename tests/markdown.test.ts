import { describe, expect, it } from 'vitest'
import { parseInline, parseMarkdown, plainText, withoutSections, type Block } from '../src/shared/markdown'

// the shape of TokenPulse's own release notes
const NOTES = `TokenPulse 2.16.0 是 Windows x64 桌面应用。

## 下载

- **安装版**：\`TokenPulse.Setup.2.16.0.exe\`，可选安装目录。
- **便携版**：\`TokenPulse-2.16.0-portable.exe\`，直接运行。

## v2.16.0 新增

- 塔罗改为 22 张「数据牌」
- 概览新增日历

## 验证

- TypeScript 类型检查通过。

使用说明见仓库 README。`

describe('markdown blocks', () => {
  it('reads the release notes', () => {
    const b = parseMarkdown(NOTES)
    expect(b.map((x) => x.t)).toEqual(['para', 'heading', 'list', 'heading', 'list', 'heading', 'list', 'para'])
    const list = b[2] as Extract<Block, { t: 'list' }>
    expect(list.tight).toBe(true)
    expect(list.items).toHaveLength(2)
    const first = list.items[0].c[0] as Extract<Block, { t: 'para' }>
    expect(first.c[0]).toEqual({ t: 'strong', c: [{ t: 'text', v: '安装版' }] })
    expect(first.c[2]).toEqual({ t: 'code', v: 'TokenPulse.Setup.2.16.0.exe' })
  })

  it('drops the download and verification sections', () => {
    const b = withoutSections(parseMarkdown(NOTES), /^(下载|验证)$/)
    expect(b.map((x) => (x.t === 'heading' ? plainText(x.c) : x.t))).toEqual(['para', 'v2.16.0 新增', 'list'])
  })

  it('nests lists, numbers them and reads task boxes', () => {
    const b = parseMarkdown('1. one\n2. two\n   - inner\n   - [x] done\n3. three')
    expect(b).toHaveLength(1)
    const ol = b[0] as Extract<Block, { t: 'list' }>
    expect(ol.ordered).toBe(true)
    expect(ol.items).toHaveLength(3)
    const inner = ol.items[1].c[1] as Extract<Block, { t: 'list' }>
    expect(inner.t).toBe('list')
    expect(inner.items.map((i) => i.checked)).toEqual([null, true])
    expect(parseMarkdown('3. a\n4. b')[0]).toMatchObject({ start: 3 })
  })

  it('makes a list loose when its items are apart', () => {
    expect(parseMarkdown('- a\n\n- b')[0]).toMatchObject({ t: 'list', tight: false, items: [{}, {}] })
  })

  it('reads fences, quotes, rules, setext headings and tables', () => {
    const b = parseMarkdown('```ts\nconst a = 1\n\nb()\n```\n> quoted\nlazy\n\n---\nTitle\n=====\n\n| a | b |\n|:--|--:|\n| 1 | 2 |\n| 3 |')
    expect(b[0]).toEqual({ t: 'code', lang: 'ts', v: 'const a = 1\n\nb()' })
    expect(b[1]).toMatchObject({ t: 'quote', c: [{ t: 'para' }] })
    expect(b[2]).toEqual({ t: 'hr' })
    expect(b[3]).toMatchObject({ t: 'heading', level: 1 })
    const table = b[4] as Extract<Block, { t: 'table' }>
    expect(table.align).toEqual(['left', 'right'])
    expect(table.rows).toHaveLength(2)
    expect(table.rows[1][1]).toEqual([])
  })

  it('keeps a paragraph going until a block starts', () => {
    const b = parseMarkdown('line one\nline two\n# head\n- item')
    expect(b.map((x) => x.t)).toEqual(['para', 'heading', 'list'])
    expect((b[0] as Extract<Block, { t: 'para' }>).c).toEqual([{ t: 'text', v: 'line one' }, { t: 'br' }, { t: 'text', v: 'line two' }])
    // a number in the middle of a sentence is not a list
    expect(parseMarkdown('see\n2. not a list').map((x) => x.t)).toEqual(['para'])
  })

  it('drops HTML comments', () => {
    expect(parseMarkdown('<!-- hidden -->\nshown')).toEqual([{ t: 'para', c: [{ t: 'text', v: 'shown' }] }])
  })
})

describe('markdown inlines', () => {
  it('reads emphasis', () => {
    expect(parseInline('a **b** *c* ***d*** ~~e~~')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'strong', c: [{ t: 'text', v: 'b' }] },
      { t: 'text', v: ' ' },
      { t: 'em', c: [{ t: 'text', v: 'c' }] },
      { t: 'text', v: ' ' },
      { t: 'strong', c: [{ t: 'em', c: [{ t: 'text', v: 'd' }] }] },
      { t: 'text', v: ' ' },
      { t: 'del', c: [{ t: 'text', v: 'e' }] }
    ])
    expect(parseInline('*a **b** c*')).toEqual([{ t: 'em', c: [{ t: 'text', v: 'a ' }, { t: 'strong', c: [{ t: 'text', v: 'b' }] }, { t: 'text', v: ' c' }] }])
  })

  it('reads bold next to Chinese punctuation', () => {
    expect(parseInline('点 **重启并更新**。')).toEqual([{ t: 'text', v: '点 ' }, { t: 'strong', c: [{ t: 'text', v: '重启并更新' }] }, { t: 'text', v: '。' }])
  })

  it('leaves stray marks and snake_case alone', () => {
    expect(plainText(parseInline('2 * 3 = 6, a_b_c, 5 ** 2'))).toBe('2 * 3 = 6, a_b_c, 5 ** 2')
    expect(parseInline('a_b_c')).toEqual([{ t: 'text', v: 'a_b_c' }])
  })

  it('reads links, bare URLs and code', () => {
    expect(parseInline('[发布页](https://github.com/x/y/releases "t")')).toEqual([{ t: 'link', href: 'https://github.com/x/y/releases', c: [{ t: 'text', v: '发布页' }] }])
    expect(parseInline('见 https://example.com/a_b。')).toEqual([
      { t: 'text', v: '见 ' },
      { t: 'link', href: 'https://example.com/a_b', c: [{ t: 'text', v: 'https://example.com/a_b' }] },
      { t: 'text', v: '。' }
    ])
    expect(parseInline('`a ** b`')).toEqual([{ t: 'code', v: 'a ** b' }])
    expect(parseInline('`` a`b ``')).toEqual([{ t: 'code', v: 'a`b' }])
  })

  it('handles escapes and HTML', () => {
    expect(parseInline('\\*not\\*')).toEqual([{ t: 'text', v: '*not*' }])
    expect(parseInline('a<br>b <sub>c</sub>')).toEqual([{ t: 'text', v: 'a' }, { t: 'br' }, { t: 'text', v: 'b c' }])
  })
})
