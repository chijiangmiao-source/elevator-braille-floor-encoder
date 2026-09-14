<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { buildCopyText, checkFloors, sortFloors } from './braille'
import type { FloorOrder } from './braille'
import BrailleCellSvg from './components/BrailleCellSvg.vue'

const input = ref('')
const copyState = ref<'idle' | 'ok' | 'fail'>('idle')
// 结果排列：默认输入顺序；刷新或经链接进入时同样回到输入顺序
const order = ref<FloorOrder>('input')

const sample = '1\n2\n10\nB1'

const result = computed(() => checkFloors(input.value))
const hasInput = computed(() => splitNonEmpty(input.value).length > 0)
// 预览、Unicode 盲文、六点 SVG 与复制文本共用同一份有序结果；
// 排序只重排已编码对象，不重新解释或改写代码
const orderedFloors = computed(() =>
  result.value.ok ? sortFloors(result.value.floors, order.value) : [],
)
const copyText = computed(() => buildCopyText(orderedFloors.value))

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
      <div class="result-table" role="table" aria-label="楼层盲文核对结果">
        <div class="result-row result-head" role="row">
          <span role="columnheader">原行</span>
          <span role="columnheader">墨字</span>
          <span role="columnheader">Unicode 盲文串</span>
          <span role="columnheader">每格六点示意（从左到右）</span>
        </div>
        <div
          v-for="floor in orderedFloors"
          :key="floor.code"
          class="result-row"
          role="row"
          data-testid="result-row"
        >
          <span class="col-line" role="cell">{{ floor.line }}</span>
          <span class="col-code" role="cell">{{ floor.code }}</span>
          <span class="col-braille" role="cell" data-testid="braille-string">{{
            floor.braille
          }}</span>
          <span class="col-cells" role="cell">
            <BrailleCellSvg
              v-for="(cell, idx) in floor.cells"
              :key="idx"
              :dots="cell.dots"
              :role-label="cell.role"
            />
          </span>
        </div>
      </div>
      <details class="copy-preview">
        <summary>复制内容预览（制表符分隔）</summary>
        <pre data-testid="copy-preview">{{ copyText }}</pre>
      </details>
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
.empty-tip {
  margin-top: 24px;
  color: #777;
  font-size: 14px;
}
</style>
