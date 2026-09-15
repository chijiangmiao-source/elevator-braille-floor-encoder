<script setup lang="ts">
import { computed } from 'vue'

/**
 * 单格六点示意（SVG）。dots 为“当前观察方向投影后”的显示点号：
 *
 *   ① ④
 *   ② ⑤
 *   ③ ⑥
 *
 * 点亮的点为实心黑圆，未点亮为浅色空心圆。
 * sourceDots 为编码原始点号（背面施工面下与显示点号不同），
 * 仅用于标题/标注，任何情况下都以原始点号表达编码语义。
 * 投影失败（error）时在对应格显示可见错误，绝不静默画出错误孔位。
 */
const props = defineProps<{
  /** 投影后落在物理槽位上的显示点号（1-6，升序） */
  dots: readonly number[]
  /** 编码原始点号；缺省与 dots 相同（成品阅读面） */
  sourceDots?: readonly number[]
  /** 是否为背面施工面镜像投影 */
  mirrored?: boolean
  roleLabel?: string
  /** 无法投影时的可见错误信息 */
  error?: string | null
}>()

// 左列点 1/2/3，右列点 4/5/6；viewBox 36×54
const DOT_LAYOUT: Readonly<Record<number, { cx: number; cy: number }>> = {
  1: { cx: 12, cy: 12 },
  2: { cx: 12, cy: 27 },
  3: { cx: 12, cy: 42 },
  4: { cx: 24, cy: 12 },
  5: { cx: 24, cy: 27 },
  6: { cx: 24, cy: 42 },
}

const source = computed(() => props.sourceDots ?? props.dots)
const active = computed(() => new Set(props.dots))
const sourceText = computed(() => source.value.join(''))
const displayText = computed(() => props.dots.join(''))
// 背面视图下显式给出“原始点号 → 镜像孔位”，正面视图只标注原始点号
const caption = computed(() => {
  const from = sourceText.value || '无'
  if (props.mirrored) return `${from}→${displayText.value || '无'}`
  return from
})
const title = computed(() => {
  const role = props.roleLabel ?? ''
  if (props.error) return `${role}：${props.error}`
  if (props.mirrored) {
    return `${role}（成品点 ${sourceText.value || '无'} → 背面孔位 ${displayText.value || '无'}）`
  }
  return `${role}（点 ${sourceText.value || '无'}）`
})
const ariaLabel = computed(() => {
  if (props.error) return `孔位投影错误：${props.error}`
  if (props.mirrored) {
    return `成品面点 ${sourceText.value || '无'}，背面镜像孔位 ${displayText.value || '无'}`
  }
  return `点 ${sourceText.value || '无'}`
})
</script>

<template>
  <span
    class="cell"
    :class="{ 'cell-error': error }"
    :title="title"
    :data-testid="error ? 'projection-error' : 'braille-cell'"
    :data-source-dots="sourceText"
    :data-display-dots="displayText"
  >
    <svg
      v-if="!error"
      viewBox="0 0 36 54"
      width="30"
      height="45"
      role="img"
      :aria-label="ariaLabel"
    >
      <rect x="1" y="1" width="34" height="52" rx="5" class="cell-frame" />
      <circle
        v-for="(pos, n) in DOT_LAYOUT"
        :key="n"
        :cx="pos.cx"
        :cy="pos.cy"
        r="5"
        :data-slot="n"
        :class="['dot', active.has(Number(n)) ? 'dot-on' : 'dot-off']"
      />
    </svg>
    <svg
      v-else
      viewBox="0 0 36 54"
      width="30"
      height="45"
      role="img"
      :aria-label="ariaLabel"
    >
      <rect x="1" y="1" width="34" height="52" rx="5" class="cell-frame cell-frame-bad" />
      <text x="18" y="35" text-anchor="middle" class="cell-bad-mark">!</text>
    </svg>
    <span class="cell-dots" :class="{ 'cell-dots-bad': error }" aria-hidden="true">{{
      error ? '投影错误' : caption
    }}</span>
  </span>
</template>

<style scoped>
.cell {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.cell-frame {
  fill: #fff;
  stroke: #333;
  stroke-width: 1.2;
}
.dot-off {
  fill: #e9e9e9;
  stroke: #b5b5b5;
  stroke-width: 1;
}
.dot-on {
  fill: #111;
}
.cell-dots {
  font-size: 10px;
  line-height: 1;
  color: #444;
  font-variant-numeric: tabular-nums;
}
.cell-frame-bad {
  stroke: #c0392b;
  stroke-width: 1.6;
  stroke-dasharray: 4 2;
  fill: #fdecea;
}
.cell-bad-mark {
  fill: #c0392b;
  font: bold 24px/1 ui-monospace, Consolas, monospace;
}
.cell-dots-bad {
  color: #c0392b;
  font-weight: 700;
}
</style>
