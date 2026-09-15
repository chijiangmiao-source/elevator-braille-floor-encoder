<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { buildCopyText, checkFloors, sortFloors } from './braille'
import type { EncodedFloor, FloorOrder } from './braille'
import { VIEW_SIDE_TEXT, projectDots } from './projection'
import type { ViewSide } from './projection'
import {
  REVIEW_STATUS_TEXT,
  createLocalStorageReviewStorage,
  floorReviewStatus,
  restoreProgress,
  serializeProgress,
  setCellDots,
  summarizeReview,
  toggleDot,
} from './review'
import type { ReviewProgress } from './review'
import BrailleCellSvg from './components/BrailleCellSvg.vue'
import ReviewCell from './components/ReviewCell.vue'
import DotPositionLegend from './components/DotPositionLegend.vue'

const input = ref('')
const copyState = ref<'idle' | 'ok' | 'fail'>('idle')
// 结果排列：默认输入顺序；刷新或经链接进入时同样回到输入顺序
const order = ref<FloorOrder>('input')
// 点位观察方向：默认成品阅读面；刷新、重新输入或出现非法批次时回到该默认值
const viewSide = ref<ViewSide>('front')

const sample = '1\n2\n10\nB1'

const result = computed(() => checkFloors(input.value))
const hasInput = computed(() => splitNonEmpty(input.value).length > 0)
// 预览、Unicode 盲文、六点 SVG 与复制文本共用同一份有序结果；
// 排序只重排已编码对象，不重新解释或改写代码
const orderedFloors = computed(() =>
  result.value.ok ? sortFloors(result.value.floors, order.value) : [],
)
const copyText = computed(() => buildCopyText(orderedFloors.value))

/* ------------------------------------------------------------------ */
/* 点位观察方向（成品阅读面 / 背面施工面）：仅显示投影，不改写编码        */
/* ------------------------------------------------------------------ */

interface DisplayCell {
  /** 当前观察方向下落在物理槽位上的显示点号（投影结果） */
  readonly displayDots: readonly number[]
  /** 编码原始点号（标题/标注与复核始终使用它） */
  readonly sourceDots: readonly number[]
  readonly role: string
  /** 无法投影的点号在此给出可见错误，而不是静默画出错误孔位 */
  readonly error: string | null
}

// 投影只作用于单格内部点号；楼层排列与格子先后随 orderedFloors 保持不变
const displayFloors = computed(() =>
  orderedFloors.value.map((floor) => ({
    floor,
    cells: floor.cells.map((cell): DisplayCell => {
      try {
        return {
          displayDots: projectDots(cell.dots, viewSide.value),
          sourceDots: cell.dots,
          role: cell.role,
          error: null,
        }
      } catch (err) {
        return {
          displayDots: [],
          sourceDots: cell.dots,
          role: cell.role,
          error: err instanceof Error ? err.message : '点位投影失败',
        }
      }
    }),
  })),
)

const isMirroredView = computed(() => viewSide.value === 'back')

// 重新输入（输入文本变化）或出现非法批次时回到成品阅读面。
// 单纯切换观察方向不改变 input，不会触发本监听；切换排列也不影响方向。
// 刷新时 viewSide 以初始值 'front' 挂载，天然回到默认阅读面。
watch(input, () => {
  viewSide.value = 'front'
})

/* ------------------------------------------------------------------ */
/* 实物逐点复核：独立复核领域模型 + localStorage 持久化                  */
/* ------------------------------------------------------------------ */

// 复核进度：楼层代码 + 单元序号为键，与展示顺序无关
const progress = ref<ReviewProgress>({})
const reviewMode = ref(false)
// 存储内容损坏 / 版本不识别 / 与当前批次不匹配时的可见提示
const storageNotice = ref<string | null>(null)
const reviewStorage = createLocalStorageReviewStorage()

// 当前合法批次的指纹（代码 + 每码单元数）；非法或空批次为 null
const batchFingerprint = computed(() =>
  result.value.ok && result.value.floors.length
    ? result.value.floors.map((f) => `${f.code}:${f.cells.length}`).join('|')
    : null,
)

function persistProgress(floors: readonly EncodedFloor[]): void {
  reviewStorage.save(serializeProgress(floors, progress.value))
}

// 合法批次一旦确定（含离开页面后重新输入同一代码批次），即从存储服务恢复进度：
// 损坏 / 版本不识别 → 放弃该份进度并提示；部分记录与当前批次不匹配 →
// 仅恢复代码与单元结构完全一致的记录，其余放弃并提示。
// 复核状态绝不参与编码计算，编码预览不受任何存储内容影响。
watch(
  batchFingerprint,
  (fingerprint) => {
    if (fingerprint === null) return
    const floors = result.value.ok ? result.value.floors : []
    const restored = restoreProgress(reviewStorage.read(), floors)
    if (restored.kind === 'empty') {
      progress.value = {}
      storageNotice.value = null
      return
    }
    if (restored.kind === 'discarded') {
      progress.value = {}
      storageNotice.value =
        restored.reason === 'version'
          ? '本地复核进度版本不识别，已放弃该份进度，可重新逐点复核。'
          : '本地复核进度已损坏，无法恢复，已放弃该份进度，可重新逐点复核。'
      // 覆盖无法识别的内容，避免每次进入都重复提示
      persistProgress(floors)
      return
    }
    progress.value = restored.progress
    if (restored.dropped.length > 0) {
      storageNotice.value = `部分复核进度与当前批次不匹配（${restored.dropped.join('、')}），已放弃不匹配的记录。`
      // 放弃不匹配部分：写回清理后的进度
      persistProgress(floors)
    } else {
      storageNotice.value = null
    }
  },
  { immediate: true },
)

// 每次实测变更立即持久化（仅当前批次合法时）
watch(progress, () => {
  if (batchFingerprint.value === null) return
  persistProgress(result.value.ok ? result.value.floors : [])
})

// 复核面板行：跟随当前排列顺序展示，记录始终按楼层代码绑定
const reviewRows = computed(() => {
  // 观察方向投影只作用于参考 SVG；复核录入、差异判断与存储均用原始点号
  const displayByCode = new Map(
    displayFloors.value.map((entry) => [entry.floor.code, entry.cells]),
  )
  return orderedFloors.value.map((floor) => ({
    floor,
    displayCells: displayByCode.get(floor.code) ?? [],
    record: progress.value[floor.code] as ReviewProgress[string] | undefined,
    status: floorReviewStatus(floor, progress.value[floor.code]),
  }))
})
const reviewSummary = computed(() =>
  summarizeReview(orderedFloors.value, progress.value),
)

function onToggleDot(code: string, cellIndex: number, dot: number): void {
  const current = progress.value[code]?.[cellIndex] ?? []
  progress.value = setCellDots(
    progress.value,
    code,
    cellIndex,
    toggleDot(current, dot),
  )
}

// 复制反馈的自动消退计时器；连续复制时以最近一次为准重新计时
let copyResetTimer: number | undefined

// 输入或排列一旦变化，复制内容即与已复制文本不同：
// 旧的“已复制/失败”反馈不再成立，回到未复制状态并取消消退计时
watch(copyText, () => {
  if (copyResetTimer !== undefined) {
    window.clearTimeout(copyResetTimer)
    copyResetTimer = undefined
  }
  copyState.value = 'idle'
})

function scheduleCopyReset(): void {
  if (copyResetTimer !== undefined) window.clearTimeout(copyResetTimer)
  copyResetTimer = window.setTimeout(() => {
    copyState.value = 'idle'
    copyResetTimer = undefined
  }, 2000)
}

function splitNonEmpty(text: string): string[] {
  return text.split(/\r\n|\r|\n/).filter((line) => line !== '')
}

async function copyResult(): Promise<void> {
  if (!result.value.ok || !copyText.value) return
  const text = copyText.value
  try {
    await navigator.clipboard.writeText(text)
    copyState.value = 'ok'
  } catch {
    // 降级：非安全上下文（如裸 http 部署）下用临时元素执行复制
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    try {
      // execCommand 以布尔返回值报告成败，失败时不会抛错
      copyState.value = document.execCommand('copy') ? 'ok' : 'fail'
    } catch {
      copyState.value = 'fail'
    } finally {
      document.body.removeChild(ta)
    }
  }
  scheduleCopyReset()
}

function onKeydown(event: KeyboardEvent): void {
  // Ctrl/Cmd + Enter：全部合法时直接复制核对结果
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault()
    void copyResult()
  }
}
</script>

<template>
  <main class="page">
    <header>
      <h1>电梯标牌盲文核对器</h1>
      <p class="hint">
        每行一个楼层代码：仅接受 <code>1</code>–<code>99</code> 或
        <code>B1</code>–<code>B9</code>（大写 B，区分大小写，代码内无空白）；空行忽略，重复代码非法。
      </p>
    </header>

    <section class="input-area">
      <label for="floor-input">墨字楼层代码（每行一个）</label>
      <textarea
        id="floor-input"
        v-model="input"
        data-testid="floor-input"
        rows="9"
        spellcheck="false"
        autocomplete="off"
        placeholder="例如：&#10;1&#10;2&#10;10&#10;B1"
        @keydown="onKeydown"
      ></textarea>
      <div class="toolbar">
        <button type="button" class="link-btn" @click="input = sample">填入示例</button>
        <button type="button" class="link-btn" @click="input = ''">清空</button>
        <button
          type="button"
          class="primary-btn"
          data-testid="copy-btn"
          :disabled="!result.ok"
          @click="copyResult"
        >
          复制核对结果（Ctrl/⌘+Enter）
        </button>
        <span
          v-if="copyState === 'ok'"
          class="copy-msg copy-ok"
          data-testid="copy-message"
          >已复制，内容与预览一致</span
        >
        <span
          v-else-if="copyState === 'fail'"
          class="copy-msg copy-fail"
          data-testid="copy-fail-message"
          >复制失败，请手动选择文本</span
        >
      </div>
      <div
        class="order-switch"
        data-testid="order-switch"
        role="radiogroup"
        aria-label="结果排列顺序"
      >
        <span class="order-label">结果排列：</span>
        <label>
          <input
            v-model="order"
            type="radio"
            name="floor-order"
            value="input"
            data-testid="order-input"
          />
          输入顺序
        </label>
        <label>
          <input
            v-model="order"
            type="radio"
            name="floor-order"
            value="floor"
            data-testid="order-floor"
          />
          楼层顺序（B9→B1、1→99）
        </label>
      </div>
    </section>

    <section v-if="hasInput && !result.ok" class="error-panel" data-testid="error-panel" role="alert">
      <p class="error-title">未生成任何结果：发现非法或重复代码</p>
      <p>
        <strong>第 {{ result.line }} 行</strong>
        <code data-testid="error-code">{{ result.code || '（空白异常）' }}</code>
        ——{{ result.reason }}
      </p>
      <p v-if="result.kind === 'duplicate'" class="error-sub">
        该代码首次出现在第 {{ result.firstLine }} 行。
      </p>
      <p class="error-sub">编码顺序：数字符（点 3456）在前；地下层依次为大写符（点 6）、字母 B（点 12）、数字符与数字。</p>
    </section>

    <section v-else-if="result.ok && result.floors.length" data-testid="result-panel">
      <h2>核对预览（墨字 ⇄ Unicode 盲文 ⇄ 每格六点）</h2>
      <div
        class="view-switch"
        data-testid="view-switch"
        role="radiogroup"
        aria-label="点位观察方向"
      >
        <span class="order-label">点位视图：</span>
        <label>
          <input
            v-model="viewSide"
            type="radio"
            name="view-side"
            value="front"
            data-testid="view-front"
          />
          成品阅读面
        </label>
        <label>
          <input
            v-model="viewSide"
            type="radio"
            name="view-side"
            value="back"
            data-testid="view-back"
          />
          背面施工面（透明板背面镜像孔位）
        </label>
      </div>
      <DotPositionLegend :side="viewSide" />
      <div class="result-table" role="table" aria-label="楼层盲文核对结果">
        <div class="result-row result-head" role="row">
          <span role="columnheader">原行</span>
          <span role="columnheader">墨字</span>
          <span role="columnheader">Unicode 盲文串</span>
          <span role="columnheader">
            每格六点示意（从左到右 · 当前：{{ VIEW_SIDE_TEXT[viewSide] }}）
          </span>
        </div>
        <div
          v-for="entry in displayFloors"
          :key="entry.floor.code"
          class="result-row"
          role="row"
          data-testid="result-row"
          :data-view="viewSide"
        >
          <span class="col-line" role="cell">{{ entry.floor.line }}</span>
          <span class="col-code" role="cell">{{ entry.floor.code }}</span>
          <span class="col-braille" role="cell" data-testid="braille-string">{{
            entry.floor.braille
          }}</span>
          <span class="col-cells" role="cell">
            <BrailleCellSvg
              v-for="(cell, idx) in entry.cells"
              :key="idx"
              :dots="cell.displayDots"
              :source-dots="cell.sourceDots"
              :mirrored="isMirroredView"
              :role-label="cell.role"
              :error="cell.error"
            />
          </span>
        </div>
      </div>
      <details class="copy-preview">
        <summary>复制内容预览（制表符分隔）</summary>
        <pre data-testid="copy-preview">{{ copyText }}</pre>
      </details>
      <div class="review-entry">
        <button
          type="button"
          class="primary-btn"
          data-testid="review-toggle"
          @click="reviewMode = !reviewMode"
        >
          {{ reviewMode ? '退出实物逐点复核' : '进入实物逐点复核' }}
        </button>
        <span v-if="!reviewMode" class="review-entry-hint">
          拿到实物标牌后，逐格录入摸到的凸点，系统即时比对缺失点与多余点
        </span>
      </div>

      <div
        v-if="reviewMode"
        class="review-panel"
        data-testid="review-panel"
      >
        <h2>实物逐点复核（点击圆点切换实测凸点）</h2>
        <p class="review-view-note" data-testid="review-view-note">
          复核录入、差异判断与保存记录始终使用成品阅读面的原始点号（1-6）；
          左侧参考图当前按「{{ VIEW_SIDE_TEXT[viewSide] }}」投影显示，仅用于观察孔位。
        </p>
        <p
          v-if="storageNotice"
          class="storage-notice"
          data-testid="storage-notice"
          role="alert"
        >
          {{ storageNotice }}
        </p>
        <p class="review-summary" data-testid="review-summary">
          待核对 <strong data-testid="count-pending">{{ reviewSummary.pending }}</strong>
          · 吻合 <strong data-testid="count-match">{{ reviewSummary.match }}</strong>
          · 不吻合 <strong data-testid="count-mismatch">{{ reviewSummary.mismatch }}</strong>
        </p>
        <div
          v-for="row in reviewRows"
          :key="row.floor.code"
          class="review-row"
          data-testid="review-row"
          :data-code="row.floor.code"
        >
          <div class="review-row-head">
            <span class="col-code">{{ row.floor.code }}</span>
            <span class="col-braille">{{ row.floor.braille }}</span>
            <span
              class="review-status"
              data-testid="review-status"
              :data-status="row.status"
              :class="`status-${row.status}`"
              >{{ REVIEW_STATUS_TEXT[row.status] }}</span
            >
          </div>
          <div class="review-cells">
            <span
              v-for="(cell, idx) in row.floor.cells"
              :key="idx"
              class="review-cell-pair"
            >
              <BrailleCellSvg
                :dots="row.displayCells[idx]?.displayDots ?? []"
                :source-dots="cell.dots"
                :mirrored="isMirroredView"
                :role-label="cell.role"
                :error="row.displayCells[idx]?.error ?? null"
              />
              <ReviewCell
                :expected="cell.dots"
                :actual="row.record?.[idx]"
                :cell-index="idx"
                :role-label="cell.role"
                @toggle="(dot) => onToggleDot(row.floor.code, idx, dot)"
              />
            </span>
          </div>
        </div>
      </div>
    </section>

    <section v-else class="empty-tip">
      <p>输入楼层代码后，此处按原行序并排显示墨字、Unicode 盲文串与每格六点示意。</p>
    </section>
  </main>
</template>

<style>
:root {
  font-family:
    'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', system-ui, sans-serif;
  color: #1d1d1f;
}
body {
  margin: 0;
  background: #f4f5f7;
}
</style>

<style scoped>
.page {
  max-width: 1080px;
  margin: 0 auto;
  padding: 28px 24px 60px;
}
h1 {
  font-size: 24px;
  margin: 0 0 6px;
}
.hint {
  margin: 0 0 20px;
  color: #555;
  font-size: 14px;
}
code {
  background: #e8e8ec;
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 13px;
}
.input-area {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
textarea {
  font: 16px/1.5 ui-monospace, 'SFMono-Regular', Consolas, monospace;
  padding: 10px 12px;
  border: 1px solid #b9bcc4;
  border-radius: 8px;
  resize: vertical;
  background: #fff;
}
textarea:focus {
  outline: 2px solid #2b6de0;
  outline-offset: 1px;
}
.toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.order-switch {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 14px;
}
.order-switch label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.order-label {
  color: #555;
}
.view-switch {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  font-size: 14px;
  margin-top: 14px;
}
.view-switch label {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.review-view-note {
  margin: 0 0 10px;
  font-size: 12px;
  color: #555;
}
button {
  font-size: 14px;
  cursor: pointer;
  border-radius: 6px;
  padding: 7px 14px;
}
.link-btn {
  background: none;
  border: none;
  color: #2b6de0;
  padding: 7px 4px;
}
.link-btn:hover {
  text-decoration: underline;
}
.primary-btn {
  background: #2b6de0;
  color: #fff;
  border: 1px solid #1f57bb;
}
.primary-btn:disabled {
  background: #a8b5cc;
  border-color: #a8b5cc;
  cursor: not-allowed;
}
.copy-msg {
  font-size: 13px;
}
.copy-ok {
  color: #1a7f37;
}
.copy-fail {
  color: #c0392b;
}
.error-panel {
  margin-top: 20px;
  border: 1px solid #e0b4b4;
  background: #fdf3f3;
  border-left: 5px solid #c0392b;
  border-radius: 8px;
  padding: 14px 18px;
}
.error-title {
  margin: 0 0 8px;
  font-weight: 700;
}
.error-panel p {
  margin: 4px 0;
}
.error-sub {
  color: #666;
  font-size: 13px;
}
h2 {
  font-size: 17px;
  margin: 28px 0 10px;
}
.result-table {
  border: 1px solid #d6d8de;
  border-radius: 8px;
  overflow: hidden;
  background: #fff;
}
.result-row {
  display: grid;
  grid-template-columns: 56px 80px 190px 1fr;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-top: 1px solid #eceef2;
}
.result-row:first-child {
  border-top: none;
}
.result-head {
  background: #f0f2f6;
  font-size: 13px;
  font-weight: 700;
}
.col-line {
  color: #777;
  font-variant-numeric: tabular-nums;
}
.col-code {
  font: 600 18px/1 ui-monospace, Consolas, monospace;
}
.col-braille {
  font: 26px/1.2 'Segoe UI Symbol', 'Noto Sans Symbols 2', 'DejaVu Sans', sans-serif;
  letter-spacing: 1px;
}
.col-cells {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.copy-preview {
  margin-top: 14px;
}
.copy-preview pre {
  background: #222;
  color: #e6e6e6;
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  overflow-x: auto;
}
.review-entry {
  margin-top: 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.review-entry-hint {
  color: #666;
  font-size: 13px;
}
.review-panel {
  margin-top: 14px;
  border: 1px solid #d6d8de;
  border-radius: 8px;
  background: #fff;
  padding: 14px 18px 18px;
}
.review-panel h2 {
  margin: 0 0 10px;
}
.storage-notice {
  margin: 0 0 10px;
  padding: 8px 12px;
  border: 1px solid #e0c34b;
  border-left: 4px solid #d9a800;
  border-radius: 6px;
  background: #fdf8e7;
  color: #6b5300;
  font-size: 13px;
}
.review-summary {
  margin: 0 0 12px;
  font-size: 14px;
  color: #444;
}
.review-summary strong {
  font-variant-numeric: tabular-nums;
}
.review-row {
  border-top: 1px solid #eceef2;
  padding: 12px 0;
}
.review-row-head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 8px;
}
.review-status {
  font-size: 13px;
  font-weight: 700;
  padding: 2px 10px;
  border-radius: 999px;
}
.status-pending {
  background: #eceef2;
  color: #555;
}
.status-match {
  background: #e3f4e8;
  color: #1a7f37;
}
.status-mismatch {
  background: #fdecea;
  color: #c0392b;
}
.review-cells {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}
.review-cell-pair {
  display: inline-flex;
  align-items: flex-start;
  gap: 6px;
  padding: 6px 8px;
  border: 1px dashed #d6d8de;
  border-radius: 8px;
}
.empty-tip {
  margin-top: 24px;
  color: #777;
  font-size: 14px;
}
</style>
