/**
 * 电梯标牌六点盲文编码（国标六点点位编号）：
 *
 *   1 4
 *   2 5
 *   3 6
 *
 * 编码规则（从左到右）：
 * - 数字串前加数字符（点 3456）；数字 1~9、0 依次使用
 *   1 / 12 / 14 / 145 / 15 / 124 / 1245 / 125 / 24 / 245。
 * - 地下层 Bn：先加大写符（点 6），再加字母 B（点 12），然后按数字串编码。
 * - 各单元之间不插入空白。
 * - Unicode 盲文图案块基准为 U+2800，点位 n 对应第 n-1 个比特。
 */

export interface BrailleCell {
  /** 该格点亮的点位编号，升序排列，如 [3, 4, 5, 6] */
  readonly dots: readonly number[]
  /** 该格含义：数字符 / 大写符 / 字母 B / 数字 n */
  readonly role: string
  /** 对应的 Unicode 盲文字符 */
  readonly char: string
}

export interface EncodedFloor {
  /** 墨字楼层代码原文 */
  readonly code: string
  /** 在输入文本中的行号（1 起，空行不计入结果但保留原行号） */
  readonly line: number
  readonly isBasement: boolean
  readonly cells: BrailleCell[]
  /** 与 cells 等长的 Unicode 盲文串，格间无空白 */
  readonly braille: string
}

export type BatchResult =
  | { readonly ok: true; readonly floors: EncodedFloor[] }
  | {
      readonly ok: false
      /** 首个问题行号（1 起） */
      readonly line: number
      readonly code: string
      readonly kind: 'invalid' | 'duplicate'
      readonly reason: string
      /** 重复时，首次出现的行号 */
      readonly firstLine?: number
    }

const BRAILLE_BASE = 0x2800

const NUMBER_SIGN_DOTS: readonly number[] = [3, 4, 5, 6]
const CAPITAL_SIGN_DOTS: readonly number[] = [6]
const LETTER_B_DOTS: readonly number[] = [1, 2]

/** 数字 1~9、0 的点位映射（题目指定） */
const DIGIT_DOTS: Readonly<Record<string, readonly number[]>> = {
  '1': [1],
  '2': [1, 2],
  '3': [1, 4],
  '4': [1, 4, 5],
  '5': [1, 5],
  '6': [1, 2, 4],
  '7': [1, 2, 4, 5],
  '8': [1, 2, 5],
  '9': [2, 4],
  '0': [2, 4, 5],
}

/** 合法代码：1-99（无前导零）或 B1-B9（大写 B），代码内部无空白 */
const VALID_CODE_RE = /^(?:[1-9][0-9]?|B[1-9])$/

/** 将一组点号转换为对应的 Unicode 盲文字符 */
export function dotsToChar(dots: readonly number[]): string {
  let bits = 0
  for (const dot of dots) {
    if (dot < 1 || dot > 6) throw new Error(`非法点号: ${dot}`)
    bits |= 1 << (dot - 1)
  }
  return String.fromCodePoint(BRAILLE_BASE + bits)
}

function makeCell(dots: readonly number[], role: string): BrailleCell {
  return { dots, role, char: dotsToChar(dots) }
}

function invalidReason(line: string): string {
  if (/\s/.test(line)) return '代码内部不得有空白字符（也不允许首尾空格）'
  if (/^[A-Za-z]/.test(line) && !line.startsWith('B')) {
    return '地下层前缀只能是大写字母 B（合法形式为 B1 至 B9）'
  }
  if (/^b/.test(line)) return '地下层前缀必须为大写字母 B（区分大小写）'
  if (line.startsWith('B')) {
    const tail = line.slice(1)
    if (!/^[1-9]$/.test(tail)) return '地下层编号必须为 B1 至 B9 中的单个数字'
  }
  if (/^0+/.test(line)) return '楼层号不得以 0 开头（合法范围为 1 至 99）'
  if (/^\d+$/.test(line)) return '楼层号必须为 1 至 99 的整数'
  return '非法楼层代码：合法形式仅为 1 至 99 或 B1 至 B9，且区分大小写'
}

/**
 * 编码单个已通过校验的楼层代码；调用非法代码会直接抛错，
 * 以保证编码结果永远只来自真实映射而非兜底响应。
 */
export function encodeFloor(code: string, line = 1): EncodedFloor {
  if (!VALID_CODE_RE.test(code)) {
    throw new Error(`非法楼层代码: ${JSON.stringify(code)}`)
  }
  const isBasement = code.startsWith('B')
  const digits = isBasement ? code.slice(1) : code

  const cells: BrailleCell[] = []
  if (isBasement) {
    cells.push(makeCell(CAPITAL_SIGN_DOTS, '大写符'))
    cells.push(makeCell(LETTER_B_DOTS, '字母 B'))
  }
  cells.push(makeCell(NUMBER_SIGN_DOTS, '数字符'))
  for (const digit of digits) {
    cells.push(makeCell(DIGIT_DOTS[digit], `数字 ${digit}`))
  }

  return {
    code,
    line,
    isBasement,
    cells,
    braille: cells.map((cell) => cell.char).join(''),
  }
}

/** 按换行切分（兼容 CRLF/CR）；保留空行，由整批校验决定忽略 */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

/**
 * 整批校验并编码：
 * - 空行忽略；
 * - 任一代码非法或重复即整批失败，不生成任何结果，只报告按行序遇到的首个问题；
 * - 全部合法时按原行序返回编码结果。
 */
export function checkFloors(text: string): BatchResult {
  const seen = new Map<string, number>()
  const floors: EncodedFloor[] = []

  const lines = splitLines(text)
  for (let i = 0; i < lines.length; i += 1) {
    const code = lines[i]
    if (code === '') continue

    const line = i + 1
    if (!VALID_CODE_RE.test(code)) {
      return { ok: false, line, code, kind: 'invalid', reason: invalidReason(code) }
    }
    const firstLine = seen.get(code)
    if (firstLine !== undefined) {
      return {
        ok: false,
        line,
        code,
        kind: 'duplicate',
        firstLine,
        reason: `代码重复：与第 ${firstLine} 行相同`,
      }
    }
    seen.set(code, line)
    floors.push(encodeFloor(code, line))
  }

  return { ok: true, floors }
}

/**
 * 复制用纯文本：每行“墨字代码 ⇥ Unicode 盲文串 ⇥ 各格点位”，
 * 其中第三列是每格六点示意的文本化（如 “3456 1”），与预览逐格一致。
 */
export function buildCopyText(floors: readonly EncodedFloor[]): string {
  return floors
    .map((floor) => {
      const dotsText = floor.cells.map((cell) => cell.dots.join('')).join(' ')
      return `${floor.code}\t${floor.braille}\t${dotsText}`
    })
    .join('\n')
}
