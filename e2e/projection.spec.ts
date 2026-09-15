import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { REVIEW_STORAGE_KEY } from '../src/review'

const SAMPLE = '1\nB1'

async function gotoApp(page: Page) {
  await page.goto('/')
  await page.getByTestId('floor-input').waitFor()
}

/** 按墨字代码精确定位结果行（避免 1 误匹配 10 / B1） */
function resultRow(page: Page, code: string): Locator {
  return page
    .getByTestId('result-row')
    .filter({ has: page.locator('.col-code', { hasText: new RegExp(`^${code}$`) }) })
}

/** 某结果行第 cellIndex 个 SVG 格中点亮孔位（物理槽位 1-6，数值升序） */
async function litSlots(cell: Locator): Promise<number[]> {
  const slots = await cell.locator('circle.dot-on').evaluateAll((nodes) =>
    nodes.map((n) => Number(n.getAttribute('data-slot'))),
  )
  return slots.sort((a, b) => a - b)
}

function previewCells(page: Page, code: string): Locator {
  return resultRow(page, code).locator('[data-testid="braille-cell"]')
}

function reviewRow(page: Page, code: string): Locator {
  return page.locator(`[data-testid="review-row"][data-code="${code}"]`)
}

async function toggleDots(page: Page, code: string, cellIndex: number, dots: number[]) {
  const cell = reviewRow(page, code).getByTestId('review-cell').nth(cellIndex)
  for (const dot of dots) {
    await cell.getByTestId(`dot-${dot}`).click()
  }
}

test.describe('点位视图：成品阅读面 / 背面施工面', () => {
  test('合法批次默认成品阅读面；切背面后 SVG 孔位与图例同步镜像，方向标注明确', async ({
    page,
  }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(SAMPLE)

    // 默认成品阅读面
    await expect(page.getByTestId('view-front')).toBeChecked()
    await expect(page.getByTestId('view-legend')).toHaveAttribute('data-side', 'front')
    await expect(page.getByTestId('view-direction')).toContainText('成品阅读面')
    const legend = page.getByTestId('legend-slot')
    await expect(legend.locator('nth=0')).toHaveAttribute('data-source-dot', '1')
    expect(await legend.evaluateAll((ns) => ns.map((n) => n.getAttribute('data-source-dot')))).toEqual(
      ['1', '2', '3', '4', '5', '6'],
    )

    // 楼层 1：数字符 3456（阅读面点亮槽位 3/4/5/6），数字 1（槽位 1）
    let numberSignCell = previewCells(page, '1').nth(0)
    expect(await litSlots(numberSignCell)).toEqual([3, 4, 5, 6])
    await expect(numberSignCell).toHaveAttribute('data-display-dots', '3456')

    // 切到背面施工面
    await page.getByTestId('view-back').check()
    await expect(page.getByTestId('view-legend')).toHaveAttribute('data-side', 'back')
    const direction = page.getByTestId('view-direction')
    await expect(direction).toContainText('背面施工面')
    await expect(direction).toContainText('1↔4')
    // 图例同步镜像：物理槽位 1/2/3 上标的原始点号变为 4/5/6
    expect(await legend.evaluateAll((ns) => ns.map((n) => n.getAttribute('data-source-dot')))).toEqual(
      ['4', '5', '6', '1', '2', '3'],
    )

    // 数字符 3456 → 孔位 1236；数字 1 → 孔位 4
    numberSignCell = previewCells(page, '1').nth(0)
    expect(await litSlots(numberSignCell)).toEqual([1, 2, 3, 6])
    await expect(numberSignCell).toHaveAttribute('data-source-dots', '3456')
    await expect(numberSignCell).toHaveAttribute('data-display-dots', '1236')
    expect(await litSlots(previewCells(page, '1').nth(1))).toEqual([4])

    // B1：6→3，12→45，3456→1236，1→4（格子先后不变，共 4 格）
    const b1Cells = previewCells(page, 'B1')
    await expect(b1Cells).toHaveCount(4)
    expect(await litSlots(b1Cells.nth(0))).toEqual([3])
    expect(await litSlots(b1Cells.nth(1))).toEqual([4, 5])
    expect(await litSlots(b1Cells.nth(2))).toEqual([1, 2, 3, 6])
    expect(await litSlots(b1Cells.nth(3))).toEqual([4])
    // 标注显式给出“原始点号 → 镜像孔位”
    await expect(b1Cells.nth(0)).toHaveAttribute('data-source-dots', '6')
    await expect(b1Cells.nth(0)).toHaveAttribute('data-display-dots', '3')

    // 楼层排列与行序不变
    await expect(page.getByTestId('result-row').locator('.col-code')).toHaveText(['1', 'B1'])

    // 切回成品阅读面立即还原
    await page.getByTestId('view-front').check()
    expect(await litSlots(previewCells(page, '1').nth(0))).toEqual([3, 4, 5, 6])
    expect(await litSlots(previewCells(page, 'B1').nth(0))).toEqual([6])
    expect(await legend.evaluateAll((ns) => ns.map((n) => n.getAttribute('data-source-dot')))).toEqual(
      ['1', '2', '3', '4', '5', '6'],
    )
  })

  test('背面施工面下 Unicode 盲文与复制文本仍使用原始点号', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(SAMPLE)
    await page.getByTestId('view-back').check()

    // 镜像的是孔位 SVG，盲文串不变
    await expect(resultRow(page, '1').getByTestId('braille-string')).toHaveText('⠼⠁')
    await expect(resultRow(page, 'B1').getByTestId('braille-string')).toHaveText('⠠⠃⠼⠁')

    // 复制内容预览仍为原始点号
    const preview = page.getByTestId('copy-preview')
    await expect(preview).toContainText('1\t⠼⠁\t3456 1')
    await expect(preview).toContainText('B1\t⠠⠃⠼⠁\t6 12 3456 1')

    // 实际复制到剪贴板的内容与预览一致，不受镜像影响
    await page.getByTestId('copy-btn').click()
    await expect(page.getByTestId('copy-message')).toBeVisible()
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    expect(clipboard).toBe((await preview.textContent())?.trim())
  })

  test('背面视图与楼层排列互不干扰：镜像不改变行序，排序不改变镜像', async ({
    page,
  }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill('2\nB1\n10\nB9\n1')
    await page.getByTestId('view-back').check()

    await expect(page.getByTestId('result-row').locator('.col-code')).toHaveText([
      '2',
      'B1',
      '10',
      'B9',
      '1',
    ])

    await page.getByTestId('order-floor').check()
    await expect(page.getByTestId('result-row').locator('.col-code')).toHaveText([
      'B9',
      'B1',
      '1',
      '2',
      '10',
    ])
    // 排列切换后背面镜像仍然生效：B9 末格数字 9（点 24）→ 孔位 15
    const b9Last = resultRow(page, 'B9').locator('[data-testid="braille-cell"]').nth(3)
    expect(await litSlots(b9Last)).toEqual([1, 5])

    await page.getByTestId('order-input').check()
    await expect(page.getByTestId('result-row').locator('.col-code')).toHaveText([
      '2',
      'B1',
      '10',
      'B9',
      '1',
    ])
    await expect(page.getByTestId('view-back')).toBeChecked()
  })
})

test.describe('背面施工面：实物复核记录与差异判断仍用原始点号', () => {
  test('镜像只影响参考 SVG；按原始点号录入得到吻合，且切换方向不写存储', async ({
    page,
  }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(SAMPLE)
    await page.getByTestId('review-toggle').click()
    await page.getByTestId('review-panel').waitFor()

    // 尚无录入：切换观察方向不得触发复核存储写入（内容前后逐字节不变）
    const readStored = () =>
      page.evaluate((k) => window.localStorage.getItem(k), REVIEW_STORAGE_KEY)
    const storedBeforeToggles = await readStored()
    await page.getByTestId('view-back').check()
    await page.getByTestId('view-front').check()
    await page.getByTestId('view-back').check()
    expect(await readStored()).toBe(storedBeforeToggles)

    const floor1 = reviewRow(page, '1')
    const referenceCell = floor1.locator('[data-testid="braille-cell"]').nth(0)
    const inputCell = floor1.getByTestId('review-cell').nth(0)

    // 背面视图：参考 SVG 已镜像为 1236，但录入控件的“应有”提示仍是原始点号 3456
    await expect(referenceCell).toHaveAttribute('data-display-dots', '1236')
    await expect(inputCell).toHaveAttribute('title', /应有 3456/)

    // 按原始点号（3/4/5/6 与 1）录入：差异判断使用原始点号 → 吻合
    await toggleDots(page, '1', 0, [3, 4, 5, 6])
    await toggleDots(page, '1', 1, [1])
    await expect(floor1.getByTestId('review-status')).toHaveText('吻合')
    await expect(page.getByTestId('count-match')).toHaveText('1')

    // 存储中保存的是原始点号，不是镜像孔位
    const stored = await page.evaluate((k) => window.localStorage.getItem(k), REVIEW_STORAGE_KEY)
    expect(JSON.parse(stored ?? '').records['1']).toEqual({
      0: [3, 4, 5, 6],
      1: [1],
    })

    // 切回成品阅读面：结论不变；再次切换方向，存储内容不变
    const storedBefore = stored
    await page.getByTestId('view-front').check()
    await expect(floor1.getByTestId('review-status')).toHaveText('吻合')
    const storedAfter = await page.evaluate((k) => window.localStorage.getItem(k), REVIEW_STORAGE_KEY)
    expect(storedAfter).toBe(storedBefore)
  })
})

test.describe('点位视图重置：刷新 / 重新输入 / 非法批次', () => {
  test('出现非法批次后视图隐藏；修正非法输入后回到默认成品阅读面', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(SAMPLE)
    await page.getByTestId('view-back').check()
    await expect(previewCells(page, '1').first()).toHaveAttribute('data-display-dots', '1236')

    // 输入非法：结果面板（含方向切换）隐藏，只报非法行
    await page.getByTestId('floor-input').fill('1\n100')
    await expect(page.getByTestId('error-panel')).toBeVisible()
    await expect(page.getByTestId('view-switch')).toHaveCount(0)
    await expect(page.getByTestId('result-panel')).toHaveCount(0)

    // 修正为合法批次：默认成品阅读面，SVG 与图例均为未镜像状态
    await page.getByTestId('floor-input').fill(SAMPLE)
    await expect(page.getByTestId('result-panel')).toBeVisible()
    await expect(page.getByTestId('view-front')).toBeChecked()
    await expect(page.getByTestId('view-legend')).toHaveAttribute('data-side', 'front')
    expect(await litSlots(previewCells(page, '1').nth(0))).toEqual([3, 4, 5, 6])
  })

  test('刷新页面后回到成品阅读面', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(SAMPLE)
    await page.getByTestId('view-back').check()
    await expect(page.getByTestId('view-back')).toBeChecked()

    await page.reload()
    await page.getByTestId('floor-input').waitFor()
    await expect(page.getByTestId('view-switch')).toHaveCount(0)

    // 重新输入同一批次：默认阅读面
    await page.getByTestId('floor-input').fill(SAMPLE)
    await expect(page.getByTestId('view-front')).toBeChecked()
    expect(await litSlots(previewCells(page, '1').nth(0))).toEqual([3, 4, 5, 6])
  })
})
