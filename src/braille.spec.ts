import { describe, expect, it } from 'vitest'
import {
  BrailleCell,
  EncodedFloor,
  buildCopyText,
  checkFloors,
  dotsToChar,
  encodeFloor,
  sortFloors,
  splitLines,
} from './braille'

function dotsOf(floor: { cells: BrailleCell[] }): number[][] {
  return floor.cells.map((cell) => [...cell.dots])
}

describe('点号 → Unicode 盲文字符', () => {
  it('基准 U+2800 与各比特一一对应', () => {
    expect(dotsToChar([])).toBe('⠀')
    expect(dotsToChar([1])).toBe('⠁')
    expect(dotsToChar([1, 2])).toBe('⠃')
    expect(dotsToChar([6])).toBe('⠠')
    expect(dotsToChar([3, 4, 5, 6])).toBe('⠼')
  })

  it('拒绝 1-6 之外的点号', () => {
    expect(() => dotsToChar([0])).toThrow()
    expect(() => dotsToChar([7])).toThrow()
  })
})

describe('数字 1-9、0 的点位映射', () => {
  const expected: ReadonlyArray<[string, string, number[]]> = [
    ['1', '⠁', [1]],
    ['2', '⠃', [1, 2]],
    ['3', '⠉', [1, 4]],
    ['4', '⠙', [1, 4, 5]],
    ['5', '⠑', [1, 5]],
    ['6', '⠋', [1, 2, 4]],
    ['7', '⠛', [1, 2, 4, 5]],
    ['8', '⠓', [1, 2, 5]],
    ['9', '⠊', [2, 4]],
  ]

  for (const [digit, char, dots] of expected) {
    it(`数字 ${digit} = 数字符 + 点 ${dots.join('')}（${char}）`, () => {
      const floor = encodeFloor(digit)
      expect(floor.braille).toBe(`⠼${char}`)
      expect(dotsOf(floor)).toEqual([[3, 4, 5, 6], dots])
    })
  }

  it('数字 0 使用点 245（只能作为 10、20… 的个位出现）', () => {
    const floor = encodeFloor('10')
    expect(floor.braille).toBe('⠼⠁⠚')
    expect(dotsOf(floor)).toEqual([[3, 4, 5, 6], [1], [2, 4, 5]])
  })

  it('两位数只在整串前加一个数字符', () => {
    expect(encodeFloor('99').braille).toBe('⠼⠊⠊')
    expect(encodeFloor('42').braille).toBe('⠼⠙⠃')
  })
})

describe('地下层 B1-B9 编码', () => {
  it('B1 = 大写符(6) + 字母B(12) + 数字符(3456) + 数字1(1)，格间无空白', () => {
    const floor = encodeFloor('B1')
    expect(floor.braille).toBe('⠠⠃⠼⠁')
    expect(floor.braille).not.toMatch(/\s/)
    expect(dotsOf(floor)).toEqual([[6], [1, 2], [3, 4, 5, 6], [1]])
    expect(floor.cells.map((c) => c.role)).toEqual([
      '大写符',
      '字母 B',
      '数字符',
      '数字 1',
    ])
  })

  it('B9 末格为数字 9 的点 24', () => {
    expect(encodeFloor('B9').braille).toBe('⠠⠃⠼⠊')
  })
})

describe('encodeFloor 对非法代码直接抛错（不存在固定/兜底响应）', () => {
  for (const bad of ['0', '100', 'B0', 'B10', 'b1', 'B', '1B', ' 1', '1 ', '1 2', 'L1', 'Ｂ1']) {
    it(`拒绝 ${JSON.stringify(bad)}`, () => {
      expect(() => encodeFloor(bad)).toThrow()
    })
  }
})

describe('checkFloors 整批校验', () => {
  it('空字符串与空行批次：成功但无楼层', () => {
    expect(checkFloors('')).toEqual({ ok: true, floors: [] })
    const blank = checkFloors('\n\r\n\r\n')
    expect(blank.ok).toBe(true)
    if (blank.ok) expect(blank.floors).toEqual([])
  })

  it('全部合法时按原行序返回，空行忽略且保留原始行号', () => {
    const r = checkFloors('\n1\n\nB1\n99\n')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.floors.map((f) => f.code)).toEqual(['1', 'B1', '99'])
    expect(r.floors.map((f) => f.line)).toEqual([2, 4, 5])
    expect(r.floors.map((f) => f.braille)).toEqual(['⠼⠁', '⠠⠃⠼⠁', '⠼⠊⠊'])
  })

  it('兼容 CRLF / CR 换行', () => {
    const r = checkFloors('1\r\nB2\r3')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.floors.map((f) => f.code)).toEqual(['1', 'B2', '3'])
  })

  it('非法代码：整批失败、不生成任何结果、定位首个问题行并说明原因', () => {
    const r = checkFloors('1\n100\nB1')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.line).toBe(2)
    expect(r.code).toBe('100')
    expect(r.kind).toBe('invalid')
    expect(r.reason).toContain('1 至 99')
  })

  it('小写 b1：原因明确指出区分大小写', () => {
    const r = checkFloors('b1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('大写')
  })

  it('代码内部/首尾空白：原因明确指出空白问题', () => {
    for (const text of [' 1', '1 ', '1\t2', 'B 1']) {
      const r = checkFloors(text)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.reason).toContain('空白')
    }
  })

  it('重复代码：报告重复行与首次出现行', () => {
    const r = checkFloors('1\n2\n1')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.kind).toBe('duplicate')
    expect(r.line).toBe(3)
    expect(r.firstLine).toBe(1)
    expect(r.reason).toContain('第 1 行')
  })

  it('首个问题优先：第 2 行非法时，不被第 3 行的重复掩盖', () => {
    const r = checkFloors('1\nB0\n1')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.line).toBe(2)
      expect(r.kind).toBe('invalid')
    }
  })

  it('不同写法的同名层不算重复（1 与 B1 均合法且不同）', () => {
    const r = checkFloors('1\nB1')
    expect(r.ok).toBe(true)
  })
})

describe('buildCopyText 复制内容与预览一致', () => {
  it('每行包含墨字、Unicode 串与每格点位列（制表符分隔，格间空格）', () => {
    const r = checkFloors('1\nB1')
    if (!r.ok) throw new Error('批次应合法')
    const text = buildCopyText(r.floors)
    expect(text).toBe('1\t⠼⠁\t3456 1\nB1\t⠠⠃⠼⠁\t6 12 3456 1')
  })
})

describe('sortFloors 楼层顺序', () => {
  function codesOf(floors: readonly EncodedFloor[]): string[] {
    return floors.map((f) => f.code)
  }

  function floorsOf(text: string): EncodedFloor[] {
    const r = checkFloors(text)
    if (!r.ok) throw new Error(`批次应合法: ${JSON.stringify(r)}`)
    return r.floors
  }

  it('地下层按 B9 → B1 排在最前（编号大者先到达）', () => {
    const sorted = sortFloors(floorsOf('B2\nB9\nB1\nB5'), 'floor')
    expect(codesOf(sorted)).toEqual(['B9', 'B5', 'B2', 'B1'])
  })

  it('地上层 1 → 99 按数值升序，两位数不按字典序（2 在 10 前）', () => {
    const sorted = sortFloors(floorsOf('10\n2\n99\n1\n9'), 'floor')
    expect(codesOf(sorted)).toEqual(['1', '2', '9', '10', '99'])
  })

  it('混合批次顺序确定：B9→B1 之后接 1→99，原行号随对象移动', () => {
    const floors = floorsOf('2\nB1\n10\nB9\n1')
    const sorted = sortFloors(floors, 'floor')
    expect(codesOf(sorted)).toEqual(['B9', 'B1', '1', '2', '10'])
    expect(sorted.map((f) => f.line)).toEqual([4, 2, 5, 1, 3])
    // 排序只重排已编码对象，盲文串与对象引用保持不变
    expect(sorted[0]).toBe(floors[3])
    expect(sorted[0].braille).toBe('⠠⠃⠼⠊')
  })

  it('不修改输入数组，输入顺序模式保持原排列', () => {
    const floors = floorsOf('2\nB1\n10')
    const before = codesOf(floors)
    const sorted = sortFloors(floors, 'floor')
    expect(sorted).not.toBe(floors)
    expect(codesOf(floors)).toEqual(before)
    expect(codesOf(sortFloors(floors, 'input'))).toEqual(['2', 'B1', '10'])
  })
})

describe('splitLines', () => {
  it('按 LF/CRLF/CR 切分并保留空行', () => {
    expect(splitLines('a\n\nb\r\nc\rd')).toEqual(['a', '', 'b', 'c', 'd'])
  })
})
