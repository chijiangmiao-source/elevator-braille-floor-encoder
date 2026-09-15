<script setup lang="ts">
import { computed } from 'vue'
import { MIRROR_DOT_MAP, VIEW_SIDE_DESCRIPTION, VIEW_SIDE_TEXT } from '../projection'
import type { ViewSide } from '../projection'

/**
 * 六点编号图例，与六点 SVG 共用同一显示投影：
 * 每个物理槽位标注“当前观察方向下落在该槽位的编码原始点号”。
 * - 成品阅读面：左列 1·2·3、右列 4·5·6；
 * - 背面施工面：左右镜像，左列 4·5·6、右列 1·2·3（1↔4、2↔5、3↔6）。
 */
const props = defineProps<{ side: ViewSide }>()

// 物理槽位按左列上→下、再右列上→下排列
const SLOT_ORDER = [1, 2, 3, 4, 5, 6] as const

const slots = computed(() =>
  SLOT_ORDER.map((slot) => ({
    slot,
    // 投影对称：该槽位上的原始点号即对槽位号再做一次同名映射
    sourceDot: props.side === 'back' ? MIRROR_DOT_MAP[slot] : slot,
  })),
)
</script>

<template>
  <div class="legend" data-testid="view-legend" :data-side="side">
    <div class="legend-head">
      <span class="legend-title">六点图例（{{ VIEW_SIDE_TEXT[side] }}）</span>
      <span class="legend-direction" data-testid="view-direction" role="status">
        {{ VIEW_SIDE_DESCRIPTION[side] }}
      </span>
    </div>
    <div class="legend-grid" role="img" :aria-label="`六点图例：${VIEW_SIDE_TEXT[side]}`">
      <span
        v-for="item in slots"
        :key="item.slot"
        class="legend-slot"
        data-testid="legend-slot"
        :data-slot="item.slot"
        :data-source-dot="item.sourceDot"
        :class="{ 'legend-slot-mirrored': side === 'back' }"
        >{{ item.sourceDot }}</span
      >
    </div>
  </div>
</template>

<style scoped>
.legend {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  margin: 10px 0 4px;
  padding: 8px 12px;
  border: 1px dashed #b9bcc4;
  border-radius: 8px;
  background: #fafbfc;
}
.legend-head {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.legend-title {
  font-size: 13px;
  font-weight: 700;
}
.legend-direction {
  font-size: 12px;
  color: #555;
}
.legend-grid {
  display: grid;
  grid-template-columns: repeat(2, 22px);
  grid-template-rows: repeat(3, 22px);
  grid-auto-flow: column;
  gap: 3px 6px;
}
.legend-slot {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  border: 1px solid #888;
  background: #fff;
  font-size: 12px;
  font-weight: 700;
  color: #1d1d1f;
  font-variant-numeric: tabular-nums;
}
.legend-slot-mirrored {
  border-color: #1f57bb;
  color: #1f57bb;
}
</style>
