import { describe, expect, it } from 'vitest'
import { checkFloors, encodeFloor } from './braille'
import type { EncodedFloor } from './braille'
import {
  REVIEW_STORAGE_KEY,
  REVIEW_STORAGE_VERSION,
  createLocalStorageReviewStorage,
  diffDots,
  floorReviewStatus,
  normalizeDots,
  restoreProgress,
  serializeProgress,
  setCellDots,
  summarizeReview,
  toggleDot,
} from './review'
import type { ReviewProgress } from './review'

function floorsOf(text: string): EncodedFloor[] {
  const r = checkFloors(text)
  if (!r.ok) throw new Error(`批次应合法: ${JSON.stringify(r)}`)
  return r.floors
}

describe('toggleDot / normalizeDots 点集操作', () => {
  it('切换凸点：未有点加入、已有点移除，结果始终升序', () => {
    expect(toggleDot([], 3)).toEqual([3])
    expect(toggleDot([3], 1)).toEqual([1, 3])
    expect(toggleDot([1, 3], 3)).toEqual([1])
    expect(toggleDot([1, 3], 1)).toEqual([3])
  })

  it('不改写原数组', () => {
    const before = [2, 4]
    toggleDot(before, 1)
    expect(before).toEqual([2, 4])
  })

  it('拒绝 1-6 之外的点号', () => {
    expect(() => toggleDot([], 0)).toThrow()
    expect(() => toggleDot([], 7)).toThrow()
    expect(() => toggleDot([], 1.5)).toThrow()
  })

  it('normalizeDots 去重并升序，非法点号抛错', () => {
    expect(normalizeDots([6, 1, 6, 3])).toEqual([1, 3, 6])
    expect(() => normalizeDots([9])).toThrow()
  })
})

describe('diffDots 点集差异', () => {
  it('完全一致时缺失与多余均为空', () => {
    expect(diffDots([3, 4, 5, 6], [3, 4, 5, 6])).toEqual({ missing: [], extra: [] })
  })

  it('缺失点 = 应有而未录；多余点 = 多录；与顺序无关', () => {
    expect(diffDots([1, 2, 4], [2, 5])).toEqual({ missing: [1, 4], extra: [5] })
    expect(diffDots([2, 5], [5, 2])).toEqual({ missing: [], extra: [] })
  })

  it('实测为空集时全部为缺失点；编码为空时全部为多余点', () => {
    expect(diffDots([1, 2], [])).toEqual({ missing: [1, 2], extra: [] })
    expect(diffDots([], [1, 2])).toEqual({ missing: [], extra: [1, 2] })
  })
})

describe('floorReviewStatus 状态推导', () => {
  const floor = encodeFloor('B1') // 4 格：6 / 12 / 3456 / 1

  it('无任何记录 → 待核对', () => {
    expect(floorReviewStatus(floor, undefined)).toBe('pending')
    expect(floorReviewStatus(floor, {})).toBe('pending')
  })

  it('部分格已录入 → 仍为待核对（即使已录格有差异）', () => {
    const record = { 0: [6], 1: [1, 2, 3] }
    expect(floorReviewStatus(floor, record)).toBe('pending')
  })

  it('全部格已录入且逐格一致 → 吻合', () => {
    const record = { 0: [6], 1: [1, 2], 2: [3, 4, 5, 6], 3: [1] }
    expect(floorReviewStatus(floor, record)).toBe('match')
  })

  it('全部格已录入且至少一格有差异 → 不吻合', () => {
    const record = { 0: [6], 1: [1, 2], 2: [3, 4, 5], 3: [1] }
    expect(floorReviewStatus(floor, record)).toBe('mismatch')
  })

  it('已录入的空点集是有效测量：摸到零凸点算不吻合而非待核对', () => {
    const record = { 0: [6], 1: [1, 2], 2: [], 3: [1] }
    expect(floorReviewStatus(floor, record)).toBe('mismatch')
  })
})

describe('setCellDots 进度写入', () => {
  it('按楼层代码 + 单元序号写入并规范化点集，不改写原进度', () => {
    const before: ReviewProgress = { 1: { 0: [3, 4, 5, 6] } }
    const after = setCellDots(before, '1', 1, [4, 1])
    expect(after).not.toBe(before)
    expect(after['1'][1]).toEqual([1, 4])
    expect(before['1'][1]).toBeUndefined()
  })

  it('拒绝非法单元序号', () => {
    expect(() => setCellDots({}, '1', -1, [1])).toThrow()
    expect(() => setCellDots({}, '1', 0.5, [1])).toThrow()
  })
})

describe('summarizeReview 汇总计数', () => {
  it('按状态统计楼层数，与逐格状态推导一致', () => {
    const floors = floorsOf('1\n10\nB1')
    // 1：两格全部吻合；10：缺格待核对；B1：四格录满但有差异
    const progress: ReviewProgress = {
      1: { 0: [3, 4, 5, 6], 1: [1] },
      10: { 0: [3, 4, 5, 6] },
      B1: { 0: [6], 1: [1, 2], 2: [3, 4, 5, 6], 3: [2] },
    }
    expect(summarizeReview(floors, progress)).toEqual({
      pending: 1,
      match: 1,
      mismatch: 1,
    })
    expect(summarizeReview(floors, {})).toEqual({ pending: 3, match: 0, mismatch: 0 })
  })
})

describe('serializeProgress / restoreProgress 往返', () => {
  it('序列化后原样恢复：进度等价、无放弃项', () => {
    const floors = floorsOf('1\n10\nB1')
    const progress: ReviewProgress = {
      1: { 0: [3, 4, 5, 6], 1: [1] },
      B1: { 0: [6], 3: [] },
    }
    const restored = restoreProgress(serializeProgress(floors, progress), floors)
    expect(restored.kind).toBe('restored')
    if (restored.kind !== 'restored') return
    expect(restored.dropped).toEqual([])
    expect(restored.progress).toEqual(progress)
  })

  it('序列化只写入属于当前批次的记录，并附带版本与批次指纹', () => {
    const floors = floorsOf('1\n2')
    const progress: ReviewProgress = {
      1: { 0: [3, 4, 5, 6] },
      99: { 0: [1] }, // 不在当前批次，不得写入
    }
    const payload = JSON.parse(serializeProgress(floors, progress))
    expect(payload.version).toBe(REVIEW_STORAGE_VERSION)
    expect(payload.batch).toEqual([
      { code: '1', cells: 2 },
      { code: '2', cells: 2 },
    ])
    expect(Object.keys(payload.records)).toEqual(['1'])
  })
})

describe('restoreProgress 存储校验', () => {
  const floors = floorsOf('1\n10\nB1')

  it('无内容（null / 空串）→ empty，不产生任何提示', () => {
    expect(restoreProgress(null, floors)).toEqual({ kind: 'empty' })
    expect(restoreProgress('', floors)).toEqual({ kind: 'empty' })
  })

  it('非 JSON 内容 → 损坏，放弃该份进度', () => {
    expect(restoreProgress('not-json{{', floors)).toEqual({
      kind: 'discarded',
      reason: 'corrupt',
    })
  })

  it('JSON 标量 / 数组 / 缺字段 → 损坏', () => {
    for (const raw of ['42', '"x"', '[1,2]', '{}', '{"version":1}', '{"version":"1","batch":[],"records":{}}']) {
      expect(restoreProgress(raw, floors)).toEqual({
        kind: 'discarded',
        reason: 'corrupt',
      })
    }
  })

  it('版本不识别 → 放弃该份进度', () => {
    const raw = JSON.stringify({ version: 99, batch: [], records: {} })
    expect(restoreProgress(raw, floors)).toEqual({
      kind: 'discarded',
      reason: 'version',
    })
  })

  it('点集非法（点号越界 / 重复 / 非整数）→ 损坏', () => {
    const base = { version: 1, batch: [{ code: '1', cells: 2 }] }
    for (const dots of [[7], [0], [1, 1], [1.5], ['1']]) {
      const raw = JSON.stringify({ ...base, records: { 1: { 0: dots } } })
      expect(restoreProgress(raw, floors)).toEqual({
        kind: 'discarded',
        reason: 'corrupt',
      })
    }
  })

  it('批次不匹配：仅恢复代码与单元结构完全一致的记录，其余列入 dropped', () => {
    const stored = serializeProgress(floorsOf('1\n10\nB1'), {
      1: { 0: [3, 4, 5, 6], 1: [1] },
      B1: { 0: [6] },
    })
    const current = floorsOf('1\n10')
    const restored = restoreProgress(stored, current)
    expect(restored.kind).toBe('restored')
    if (restored.kind !== 'restored') return
    expect(restored.dropped).toEqual(['B1'])
    expect(restored.progress).toEqual({ 1: { 0: [3, 4, 5, 6], 1: [1] } })
  })

  it('单元结构不一致（指纹单元数被改写）→ 该楼层记录被放弃', () => {
    const raw = JSON.stringify({
      version: 1,
      batch: [{ code: '1', cells: 5 }], // 实际代码 1 只有 2 格
      records: { 1: { 0: [3, 4, 5, 6] } },
    })
    const restored = restoreProgress(raw, floors)
    expect(restored.kind).toBe('restored')
    if (restored.kind !== 'restored') return
    expect(restored.dropped).toEqual(['1'])
    expect(restored.progress).toEqual({})
  })

  it('单元序号超出当前楼层格数 → 该楼层记录被放弃', () => {
    const raw = JSON.stringify({
      version: 1,
      batch: [{ code: '1', cells: 2 }],
      records: { 1: { 0: [3, 4, 5, 6], 5: [1] } },
    })
    const restored = restoreProgress(raw, floors)
    expect(restored.kind).toBe('restored')
    if (restored.kind !== 'restored') return
    expect(restored.dropped).toEqual(['1'])
  })

  it('记录按代码绑定而非顺序：当前批次顺序不同也能完整恢复', () => {
    const stored = serializeProgress(floorsOf('1\n10\nB1'), {
      10: { 0: [3, 4, 5, 6], 1: [1], 2: [2, 4, 5] },
    })
    const restored = restoreProgress(stored, floorsOf('B1\n10\n1'))
    expect(restored.kind).toBe('restored')
    if (restored.kind !== 'restored') return
    expect(restored.dropped).toEqual([])
    expect(restored.progress['10'][2]).toEqual([2, 4, 5])
  })
})

describe('ReviewStorage 读取/保存契约', () => {
  it('localStorage 实现：写入后可读回，键名默认且可覆盖', () => {
    const backing = new Map<string, string>()
    const fakeLocalStorage = {
      getItem: (k: string) => backing.get(k) ?? null,
      setItem: (k: string, v: string) => void backing.set(k, v),
    }
    const original = (globalThis as Record<string, unknown>).window
    ;(globalThis as Record<string, unknown>).window = {
      localStorage: fakeLocalStorage,
    }
    try {
      const storage = createLocalStorageReviewStorage()
      expect(storage.read()).toBeNull()
      storage.save('{"a":1}')
      expect(storage.read()).toBe('{"a":1}')
      expect(backing.get(REVIEW_STORAGE_KEY)).toBe('{"a":1}')

      const custom = createLocalStorageReviewStorage('other-key')
      custom.save('x')
      expect(backing.get('other-key')).toBe('x')
    } finally {
      if (original === undefined) delete (globalThis as Record<string, unknown>).window
      else (globalThis as Record<string, unknown>).window = original
    }
  })

  it('环境不支持 localStorage 时读写安全降级（读 null、写静默）', () => {
    // node 环境下无 window：契约实现不得抛错
    const storage = createLocalStorageReviewStorage()
    expect(storage.read()).toBeNull()
    expect(() => storage.save('x')).not.toThrow()
  })
})
