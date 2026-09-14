/**
 * 实物逐点复核领域模块（独立于编码模块 braille.ts）：
 *
 * 雕刻人员拿到实物标牌后，把摸到的凸点逐格录入，系统即时比对编码结果：
 * - 每个盲文格记录一份“实测点集”（点号 1-6，升序）；
 * - 比对给出缺失点（应有而未录）与多余点（多录）；
 * - 楼层状态：待核对（尚有格未录入）/ 吻合（全部格一致）/ 不吻合（全部录入但有差异）。
 *
 * 进度以“楼层代码 + 单元序号”为键保存，与展示顺序无关：
 * 排列切换只改变展示顺序，不改写任何记录。
 *
 * 持久化通过存储服务的读取/保存契约（ReviewStorage）写入 localStorage；
 * 存储内容损坏、版本不识别或与当前合法批次不匹配时放弃对应进度，
 * 由调用方给出可见提示——本模块只返回结果，不触碰 DOM。
 */

import type { EncodedFloor } from './braille'

/** 存储格式版本：结构变更时递增，旧版本内容一律放弃 */
export const REVIEW_STORAGE_VERSION = 1

/** localStorage 键名 */
export const REVIEW_STORAGE_KEY = 'elevator-braille-review'

/** 楼层复核状态 */
export type ReviewStatus = 'pending' | 'match' | 'mismatch'

export const REVIEW_STATUS_TEXT: Readonly<Record<ReviewStatus, string>> = {
  pending: '待核对',
  match: '吻合',
  mismatch: '不吻合',
}

/** 单个盲文格的实测点集与编码点集之间的差异 */
export interface DotDiff {
  /** 缺失点：编码应有而实测未录（升序） */
  readonly missing: readonly number[]
  /** 多余点：实测录入但编码不应有（升序） */
  readonly extra: readonly number[]
}

/**
 * 一个楼层的实测记录：单元序号（0 起）→ 实测点集。
 * 键不存在表示该格尚未录入；已录入的空数组表示“摸到零个凸点”，
 * 与未录入不同——它是一份有效测量，参与吻合判定。
 */
export type FloorReview = Readonly<Record<number, readonly number[]>>

/** 整批复核进度：楼层代码 → 该楼层的实测记录 */
export type ReviewProgress = Readonly<Record<string, FloorReview>>

/** 汇总计数：三种状态各自的楼层数 */
export interface ReviewSummary {
  readonly pending: number
  readonly match: number
  readonly mismatch: number
}

function assertDot(dot: number): void {
  if (!Number.isInteger(dot) || dot < 1 || dot > 6) {
    throw new Error(`非法点号: ${dot}`)
  }
}

/** 校验并规范化一组点号：升序、去重；非法点号抛错 */
export function normalizeDots(dots: readonly number[]): number[] {
  const unique = [...new Set(dots)]
  for (const dot of unique) assertDot(dot)
  return unique.sort((a, b) => a - b)
}

/** 在点集中切换某个凸点，返回新的升序点集（不改写入参） */
export function toggleDot(dots: readonly number[], dot: number): number[] {
  assertDot(dot)
  const set = new Set(dots)
  if (set.has(dot)) set.delete(dot)
  else set.add(dot)
  return [...set].sort((a, b) => a - b)
}

/** 比对编码点集与实测点集，给出缺失点与多余点 */
export function diffDots(
  expected: readonly number[],
  actual: readonly number[],
): DotDiff {
  const actualSet = new Set(actual)
  const expectedSet = new Set(expected)
  return {
    missing: expected.filter((dot) => !actualSet.has(dot)).sort((a, b) => a - b),
    extra: actual.filter((dot) => !expectedSet.has(dot)).sort((a, b) => a - b),
  }
}

/**
 * 推导楼层复核状态：
 * - 任一格无实测记录 → 待核对；
 * - 全部格已录入且逐格一致 → 吻合；
 * - 全部格已录入且至少一格有差异 → 不吻合。
 */
export function floorReviewStatus(
  floor: EncodedFloor,
  record: FloorReview | undefined,
): ReviewStatus {
  let touched = 0
  let hasDiff = false
  for (let i = 0; i < floor.cells.length; i += 1) {
    const actual = record?.[i]
    if (actual === undefined) continue
    touched += 1
    const diff = diffDots(floor.cells[i].dots, actual)
    if (diff.missing.length > 0 || diff.extra.length > 0) hasDiff = true
  }
  if (touched < floor.cells.length) return 'pending'
  return hasDiff ? 'mismatch' : 'match'
}

/** 汇总整批各状态楼层数（与复核面板共用同一模型） */
export function summarizeReview(
  floors: readonly EncodedFloor[],
  progress: ReviewProgress,
): ReviewSummary {
  const summary = { pending: 0, match: 0, mismatch: 0 }
  for (const floor of floors) {
    summary[floorReviewStatus(floor, progress[floor.code])] += 1
  }
  return summary
}

/**
 * 写入某楼层某格的实测点集，返回新的进度对象（不改写入参）。
 * dots 会被规范化（升序去重）；空数组表示“已录入、零凸点”。
 */
export function setCellDots(
  progress: ReviewProgress,
  code: string,
  cellIndex: number,
  dots: readonly number[],
): ReviewProgress {
  if (!Number.isInteger(cellIndex) || cellIndex < 0) {
    throw new Error(`非法单元序号: ${cellIndex}`)
  }
  const floorRecord = { ...(progress[code] ?? {}) }
  floorRecord[cellIndex] = normalizeDots(dots)
  return { ...progress, [code]: floorRecord }
}

/* ------------------------------------------------------------------ */
/* 存储服务契约与 localStorage 实现                                     */
/* ------------------------------------------------------------------ */

/** 存储服务的读取/保存契约：复核模块只依赖此接口，不直接触碰 localStorage */
export interface ReviewStorage {
  /** 读取原始串；无内容或读取失败时返回 null */
  read(): string | null
  /** 写入原始串；写入失败时静默降级（进度仅保留在内存） */
  save(raw: string): void
}

/** 基于 window.localStorage 的存储服务；环境不支持时读写均安全降级 */
export function createLocalStorageReviewStorage(
  key: string = REVIEW_STORAGE_KEY,
): ReviewStorage {
  return {
    read() {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },
    save(raw: string) {
      try {
        window.localStorage.setItem(key, raw)
      } catch {
        // 隐私模式 / 配额不足：放弃持久化，不影响页面内复核
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* 进度的序列化与恢复                                                   */
/* ------------------------------------------------------------------ */

/** 批次指纹条目：楼层代码 + 单元（盲文格）数，用于恢复时核对结构 */
interface StoredBatchEntry {
  readonly code: string
  readonly cells: number
}

interface StoredPayload {
  readonly version: number
  readonly batch: readonly StoredBatchEntry[]
  readonly records: Record<string, Record<string, number[]>>
}

export type RestoreResult =
  | { readonly kind: 'empty' }
  | {
      readonly kind: 'restored'
      readonly progress: ReviewProgress
      /** 与当前批次不匹配而被放弃的楼层代码 */
      readonly dropped: readonly string[]
    }
  | { readonly kind: 'discarded'; readonly reason: 'corrupt' | 'version' }

/**
 * 序列化当前批次的复核进度：
 * 附带批次指纹（有序代码 + 每码单元数），只写入属于当前批次的记录。
 */
export function serializeProgress(
  floors: readonly EncodedFloor[],
  progress: ReviewProgress,
): string {
  const batch: StoredBatchEntry[] = floors.map((floor) => ({
    code: floor.code,
    cells: floor.cells.length,
  }))
  const records: Record<string, Record<string, number[]>> = {}
  for (const floor of floors) {
    const record = progress[floor.code]
    if (!record) continue
    const cells: Record<string, number[]> = {}
    for (const [indexText, dots] of Object.entries(record)) {
      const index = Number(indexText)
      if (!Number.isInteger(index) || index < 0 || index >= floor.cells.length) {
        continue
      }
      cells[indexText] = normalizeDots(dots)
    }
    if (Object.keys(cells).length > 0) records[floor.code] = cells
  }
  const payload: StoredPayload = { version: REVIEW_STORAGE_VERSION, batch, records }
  return JSON.stringify(payload)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidDotArray(value: unknown): value is number[] {
  if (!Array.isArray(value)) return false
  const seen = new Set<number>()
  for (const dot of value) {
    if (!Number.isInteger(dot) || dot < 1 || dot > 6 || seen.has(dot)) return false
    seen.add(dot)
  }
  return true
}

/** 校验存储载荷结构；不合法返回 null */
function validatePayload(value: Record<string, unknown>): StoredPayload | null {
  if (typeof value.version !== 'number') return null
  if (!Array.isArray(value.batch) || !isPlainObject(value.records)) return null

  const codes = new Set<string>()
  for (const entry of value.batch) {
    if (!isPlainObject(entry)) return null
    if (typeof entry.code !== 'string' || entry.code === '') return null
    if (typeof entry.cells !== 'number' || !Number.isInteger(entry.cells) || entry.cells < 1) {
      return null
    }
    if (codes.has(entry.code)) return null
    codes.add(entry.code)
  }

  const records: Record<string, Record<string, number[]>> = {}
  for (const [code, cellMap] of Object.entries(value.records)) {
    if (!isPlainObject(cellMap)) return null
    const cells: Record<string, number[]> = {}
    for (const [indexText, dots] of Object.entries(cellMap)) {
      if (!/^\d+$/.test(indexText) || !isValidDotArray(dots)) return null
      cells[indexText] = [...dots].sort((a, b) => a - b)
    }
    records[code] = cells
  }

  return {
    version: value.version,
    batch: value.batch as StoredBatchEntry[],
    records,
  }
}

/**
 * 从存储内容恢复复核进度，并与当前合法批次对账：
 * - 无内容 → empty；
 * - 内容损坏（非 JSON / 结构非法）→ discarded(corrupt)；
 * - 版本不识别 → discarded(version)；
 * - 逐楼层恢复：仅当“代码 + 单元结构”与当前批次完全一致时恢复该楼层的
 *   实测记录，其余楼层代码列入 dropped（由调用方提示并放弃）。
 */
export function restoreProgress(
  raw: string | null,
  floors: readonly EncodedFloor[],
): RestoreResult {
  if (raw === null || raw === '') return { kind: 'empty' }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { kind: 'discarded', reason: 'corrupt' }
  }

  if (!isPlainObject(parsed) || typeof parsed.version !== 'number') {
    return { kind: 'discarded', reason: 'corrupt' }
  }
  if (parsed.version !== REVIEW_STORAGE_VERSION) {
    return { kind: 'discarded', reason: 'version' }
  }
  const payload = validatePayload(parsed)
  if (payload === null) {
    return { kind: 'discarded', reason: 'corrupt' }
  }

  const batchByCode = new Map(payload.batch.map((entry) => [entry.code, entry]))
  const progress: Record<string, FloorReview> = {}
  const dropped: string[] = []

  for (const [code, cellMap] of Object.entries(payload.records)) {
    const floor = floors.find((f) => f.code === code)
    const entry = batchByCode.get(code)
    const indices = Object.keys(cellMap).map(Number)
    const structureMatches =
      floor !== undefined &&
      entry !== undefined &&
      entry.cells === floor.cells.length &&
      indices.every((index) => index >= 0 && index < floor.cells.length)
    if (!structureMatches) {
      dropped.push(code)
      continue
    }
    const record: Record<number, readonly number[]> = {}
    for (const [indexText, dots] of Object.entries(cellMap)) {
      record[Number(indexText)] = dots
    }
    progress[code] = record
  }

  return { kind: 'restored', progress, dropped }
}
