<script setup lang="ts">
import { computed } from 'vue'

/**
 * 单格六点示意（SVG）：
 *
 *   ① ④
 *   ② ⑤
 *   ③ ⑥
 *
 * 点亮的点为实心黑圆，未点亮为浅色空心圆。
 */
const props = defineProps<{
  dots: readonly number[]
  roleLabel?: string
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

const active = computed(() => new Set(props.dots))
const orderedDots = computed(() => props.dots.join(''))
</script>

<template>
  <span class="cell" :title="`${roleLabel ?? ''}（点 ${orderedDots || '无'}）`">
    <svg viewBox="0 0 36 54" width="30" height="45" role="img" :aria-label="`点 ${orderedDots || '无'}`">
      <rect x="1" y="1" width="34" height="52" rx="5" class="cell-frame" />
      <circle
        v-for="(pos, n) in DOT_LAYOUT"
        :key="n"
        :cx="pos.cx"
        :cy="pos.cy"
        r="5"
        :class="['dot', active.has(Number(n)) ? 'dot-on' : 'dot-off']"
      />
    </svg>
    <span class="cell-dots" aria-hidden="true">{{ orderedDots || '—' }}</span>
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
</style>
