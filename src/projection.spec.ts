import { describe, expect, it } from 'vitest'
import { checkFloors, encodeFloor, buildCopyText } from './braille'
import { MIRROR_DOT_MAP, projectDots } from './projection'
import type { ViewSide } from './projection'

describe('背面施工面投影：六个点号各自成对换位', () => {
  // 六组点位换位：1→4、2→5、3→6 以及反向 4→1、5→2、6→3
  const sixSwaps: ReadonlyArray<[number, number]> = [
    [1, 4],
    [2, 5],
    [3, 6],
    [4, 1],
    [5, 2],
    [6, 3],
  ]

  for (const [from, to] of sixSwaps) {
    it(`点 ${from} 在背面施工面落到孔位 ${to}`, () => {
      expect(projectDots([from], 'back')).toEqual([to])
    })
  }

  it('映射表本身对称（成对换位，共 3 对、覆盖 6 个点号）', () => {
    expect(Object.keys(MIRROR_DOT_MAP).sort((a, b) => Number(a) - Number(b))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
    ])
    for (const dot of [1, 2, 3]) {
      expect(MIRROR_DOT_MAP[MIRROR_DOT_MAP[dot]]).toBe(dot)
    }
  })

  it('多点格：只做左右列成对换位，结果按点号升序返回', () => {
    // 数字符 3456：3→6、4→1、5→2、6→3 → 1236
    expect(projectDots([3, 4, 5, 6], 'back')).toEqual([1, 2, 3, 6])
    // 字母 B 12：1→4、2→5 → 45
    expect(projectDots([1, 2], 'back')).toEqual([4, 5])
    // 数字 4 为 145：1→4、4→1、5→2 → 124
    expect(projectDots([1, 4, 5], 'back')).toEqual([1, 2, 4])
    // 数字 0 为 245：2→5、4→1、5→2 → 125
    expect(projectDots([2, 4, 5], 'back')).toEqual([1, 2, 5])
  })

  it('成品阅读面为恒等投影（包含空点格）', () => {
    for (const side of ['front', 'back'] as ViewSide[]) {
      expect(projectDots([], side)).toEqual([])
    }
    expect(projectDots([3, 4, 5, 6], 'front')).toEqual([3, 4, 5, 6])
    expect(projectDots([1, 2], 'front')).toEqual([1, 2])
  })
})

describe('双次镜像可还原', () => {
  const cases: number[][] = [
    [],
    [1],
    [6],
    [1, 2],
    [2, 4],
    [2, 4, 5],
    [3, 4, 5, 6],
    [1, 2, 3, 4, 5, 6],
  ]

  for (const dots of cases) {
    it(`点 ${dots.join('') || '无'}：背面再投影一次回到原点集`, () => {
      const once = projectDots(dots, 'back')
      expect(projectDots(once, 'back')).toEqual([...dots].sort((a, b) => a - b))
    })
  }
})

describe('投影是只读视图：源编码、Unicode 盲文与复制文本均不被改写', () => {
  function floorsOf(text: string) {
    const r = checkFloors(text)
    if (!r.ok) throw new Error(`批次应合法: ${JSON.stringify(r)}`)
    return r.floors
  }

  it('投影不改写入参点数组，也不改写已编码单元', () => {
    const floor = encodeFloor('B1')
    const originalCells = floor.cells.map((c) => [...c.dots])
    const sourceDots = floor.cells.map((c) => c.dots)
    for (const side of ['front', 'back'] as ViewSide[]) {
      for (const cell of floor.cells) projectDots(cell.dots, side)
    }
    expect(floor.cells.map((c) => [...c.dots])).toEqual(originalCells)
    // 投影结果是新数组，与源数组不是同一引用
    const projected = projectDots(sourceDots[0], 'back')
    expect(projected).not.toBe(sourceDots[0])
  })

  it('切换到背面施工面后，盲文串、原始点号与复制文本仍是成品阅读面编码', () => {
    const floors = floorsOf('1\nB1')
    const copyBefore = buildCopyText(floors)
    // 对全部格做背面投影（模拟显示层），再取复制文本：二者互不影响
    const mirrored = floors.map((f) => f.cells.map((c) => projectDots(c.dots, 'back')))
    expect(mirrored[0]).toEqual([
      [1, 2, 3, 6], // 3456 → 1236
      [4], // 1 → 4
    ])
    expect(buildCopyText(floors)).toBe(copyBefore)
    expect(floors.map((f) => f.braille)).toEqual(['⠼⠁', '⠠⠃⠼⠁'])
    expect(copyBefore).toBe('1\t⠼⠁\t3456 1\nB1\t⠠⠃⠼⠁\t6 12 3456 1')
  })
})

describe('无法投影的点号在投影层即报错（不得静默画出错误孔位）', () => {
  for (const bad of [0, 7, -1, 1.5, NaN]) {
    it(`拒绝点号 ${String(bad)}`, () => {
      expect(() => projectDots([bad], 'back')).toThrow()
      expect(() => projectDots([1, bad, 3], 'back')).toThrow()
    })
  }

  it('成品阅读面同样拒绝非法点号（恒等投影也不兜底）', () => {
    expect(() => projectDots([8], 'front')).toThrow()
  })
})
