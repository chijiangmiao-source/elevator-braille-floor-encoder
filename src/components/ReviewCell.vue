<script setup lang="ts">
import { computed } from 'vue'
import { diffDots } from '../review'

/**
 * 实物逐点复核用的交互六点图（与 BrailleCellSvg 同一六点布局）：
 *
 *   ① ④
 *   ② ⑤
 *   ③ ⑥
 *
 * 点击圆点在“实测点集”中切换该凸点；录入后即时标出：
 * - 缺失点（编码应有而未录）：红色虚线空心；
 * - 多余点（不应有而录入）：红色实心；
 * - 吻合点：黑色实心。
 */
const props = defineProps<{
  /** 编码应有点位 */
  expected: readonly number[]
  /** 实测点集；undefined 表示该格尚未录入 */
  actual: readonly number[] | undefined
  /** 单元序号（0 起），用于提示文本 */
  cellIndex: number
  roleLabel?: string
}>()

const emit = defineEmits<{ toggle: [dot: number] }>()

const DOTS = [1, 2, 3, 4, 5, 6] as const

const expectedSet = computed(() => new Set(props.expected))
const actualSet = computed(() => new Set(props.actual ?? []))
const touched = computed(() => props.actual !== undefined)
const diff = computed(() =>
  props.actual === undefined ? null : diffDots(props.expected, props.actual),
)

const diffText = computed(() => {
  if (!touched.value) return '未录入'
  const d = diff.value
  if (!d || (d.missing.length === 0 && d.extra.length === 0)) return '一致'
  const parts: string[] = []
  if (d.missing.length > 0) parts.push(`缺 ${d.missing.join(' ')}`)
  if (d.extra.length > 0) parts.push(`多 ${d.extra.join(' ')}`)
  return parts.join(' · ')
})

function dotClass(dot: number): string[] {
  const classes = ['rdot']
  const on = actualSet.value.has(dot)
  const should = expectedSet.value.has(dot)
  if (on && should) classes.push('rdot-hit')
  else if (on && !should) classes.push('rdot-extra')
  else if (!on && should) classes.push(touched.value ? 'rdot-missing' : 'rdot-expected')
  else classes.push('rdot-idle')
  return classes
}

function dotTitle(dot: number): string {
  const state = actualSet.value.has(dot) ? '已录' : '未录'
  return `点 ${dot}（${state}，点击切换）`
}
</script>

<template>
  <span
    class="rcell"
    data-testid="review-cell"
    :data-touched="touched ? 'true' : 'false'"
    :title="`${roleLabel ?? ''}（应有 ${expected.join('') || '无'}）`"
  >
    <span class="rcell-grid" role="group" :aria-label="`第 ${cellIndex + 1} 格实测凸点`">
      <button
        v-for="dot in DOTS"
        :key="dot"
        type="button"
        :class="dotClass(dot)"
        :data-testid="`dot-${dot}`"
        :aria-pressed="actualSet.has(dot)"
        :title="dotTitle(dot)"
        @click="emit('toggle', dot)"
      ></button>
    </span>
    <span
      class="rcell-diff"
      data-testid="cell-diff"
      :data-state="!touched ? 'untouched' : diff && (diff.missing.length || diff.extra.length) ? 'diff' : 'same'"
      >{{ diffText }}</span
    >
  </span>
</template>

<style scoped>
.rcell {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.rcell-grid {
  display: grid;
  grid-template-columns: repeat(2, 16px);
  grid-template-rows: repeat(3, 16px);
  grid-auto-flow: column;
  gap: 3px 4px;
  padding: 4px;
  border: 1px solid #333;
  border-radius: 5px;
  background: #fff;
}
.rdot {
  width: 16px;
  height: 16px;
  padding: 0;
  border-radius: 50%;
  border: 1.5px solid #b5b5b5;
  background: #f2f2f2;
  cursor: pointer;
}
.rdot:focus-visible {
  outline: 2px solid #2b6de0;
  outline-offset: 1px;
}
/* 未录入时，应有点以浅灰提示 */
.rdot-expected {
  background: #e9e9e9;
  border-color: #888;
}
/* 吻合：实测与编码一致 */
.rdot-hit {
  background: #111;
  border-color: #111;
}
/* 缺失点：编码应有而未录 */
.rdot-missing {
  background: #fff;
  border: 2px dashed #c0392b;
}
/* 多余点：不应有而录入 */
.rdot-extra {
  background: #c0392b;
  border-color: #8f2b20;
}
.rdot-idle {
  background: #f7f7f7;
}
.rcell-diff {
  font-size: 10px;
  line-height: 1;
  color: #444;
  min-height: 10px;
  font-variant-numeric: tabular-nums;
}
.rcell-diff[data-state='diff'] {
  color: #c0392b;
  font-weight: 700;
}
.rcell-diff[data-state='same'] {
  color: #1a7f37;
}
</style>
