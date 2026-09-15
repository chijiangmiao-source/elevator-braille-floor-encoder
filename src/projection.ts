/**
 * 点位观察方向的显示投影（只改变“怎么看”，绝不参与编码）：
 *
 * - 成品阅读面（front，默认）：从盲文读者方向观察，左列 1-2-3、右列 4-5-6。
 * - 背面施工面（back）：部分标牌采用透明板背面打孔，施工人员看到的是与
 *   成品阅读面左右镜像的孔位模板——每格左列的 1/2/3 与右列的 4/5/6
 *   成对换位：1↔4、2↔5、3↔6。
 *
 * 投影只作用于“单格内部的点号落在哪个物理槽位”，楼层排列与格子先后
 * （单元顺序）完全不变。六点 SVG 与页面图例共用本投影；Unicode 盲文、
 * 复制文本、实物复核记录与差异判断始终使用原始点号，不经过本模块，
 * 因此施工视图既不改写编码，也不改写已保存的复核进度。
 */

/** 点位观察方向 */
export type ViewSide = 'front' | 'back'

/** 单选标签文案 */
export const VIEW_SIDE_TEXT: Readonly<Record<ViewSide, string>> = {
  front: '成品阅读面',
  back: '背面施工面（左右镜像）',
}

/** 方向标注：明确告知当前观察方向（含镜像规则说明） */
export const VIEW_SIDE_DESCRIPTION: Readonly<Record<ViewSide, string>> = {
  front:
    '当前观察方向：成品阅读面（从读者方向观察，左列 1·2·3，右列 4·5·6）。',
  back:
    '当前观察方向：背面施工面（透明板背面所见孔位，与成品阅读面左右镜像：1↔4、2↔5、3↔6；楼层排列与格子先后不变）。',
}

/**
 * 背面观察时的成对换位：原始点号 n 在背面落到点 MIRROR_DOT_MAP[n]
 * 的物理槽位（左右镜像，行不变）。映射对称，再次投影即还原。
 */
export const MIRROR_DOT_MAP: Readonly<Record<number, number>> = {
  1: 4,
  2: 5,
  3: 6,
  4: 1,
  5: 2,
  6: 3,
}

/**
 * 把一组原始点号投影到指定观察方向：
 * - front：恒等投影（返回升序副本，不改写源数组）；
 * - back：1↔4、2↔5、3↔6 成对换位后按点号升序返回。
 *
 * 任何不是 1-6 整数的点号都无法投影，直接抛错——调用方必须在对应格
 * 给出可见错误，绝不允许静默画出错误孔位。
 */
export function projectDots(
  dots: readonly number[],
  side: ViewSide,
): number[] {
  const projected: number[] = []
  for (const dot of dots) {
    if (!Number.isInteger(dot) || dot < 1 || dot > 6) {
      throw new Error(`无法投影的点号: ${String(dot)}`)
    }
    projected.push(side === 'back' ? MIRROR_DOT_MAP[dot] : dot)
  }
  return projected.sort((a, b) => a - b)
}
