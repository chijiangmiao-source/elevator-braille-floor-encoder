import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { REVIEW_STORAGE_KEY } from '../src/review'

const SAMPLE = '1\n10\nB1'

async function gotoApp(page: Page) {
  await page.goto('/')
  await page.getByTestId('floor-input').waitFor()
}

async function enterReview(page: Page, input: string) {
  await page.getByTestId('floor-input').fill(input)
  await page.getByTestId('review-toggle').click()
  await page.getByTestId('review-panel').waitFor()
}

function reviewRow(page: Page, code: string) {
  return page.locator(`[data-testid="review-row"][data-code="${code}"]`)
}

/** 在指定楼层的某一格六点图上依次点击给定凸点 */
async function toggleDots(page: Page, code: string, cellIndex: number, dots: number[]) {
  const cell = reviewRow(page, code).getByTestId('review-cell').nth(cellIndex)
  for (const dot of dots) {
    await cell.getByTestId(`dot-${dot}`).click()
  }
}

/** 按编码逐格录入完全一致的凸点 */
async function enterFloorCorrectly(page: Page, code: string, cells: number[][]) {
  for (let i = 0; i < cells.length; i += 1) {
    await toggleDots(page, code, i, cells[i])
  }
}

const FLOOR_1_CELLS = [[3, 4, 5, 6], [1]]
const FLOOR_B1_CELLS = [[6], [1, 2], [3, 4, 5, 6], [1]]

test.describe('实物逐点复核：逐点录入后的状态变化', () => {
  test('录入凸点即时标出缺失点与多余点，楼层状态与汇总同步更新', async ({
    page,
  }) => {
    await gotoApp(page)
    await enterReview(page, SAMPLE)

    // 初始：全部待核对
    await expect(page.getByTestId('review-row')).toHaveCount(3)
    await expect(page.getByTestId('count-pending')).toHaveText('3')
    await expect(page.getByTestId('count-match')).toHaveText('0')
    await expect(page.getByTestId('count-mismatch')).toHaveText('0')
    await expect(
      reviewRow(page, '1').getByTestId('review-status'),
    ).toHaveText('待核对')

    // 楼层 1：两格全部录入且一致 → 吻合
    await enterFloorCorrectly(page, '1', FLOOR_1_CELLS)
    await expect(reviewRow(page, '1').getByTestId('review-status')).toHaveText(
      '吻合',
    )
    await expect(page.getByTestId('count-match')).toHaveText('1')
    await expect(page.getByTestId('count-pending')).toHaveText('2')

    // 楼层 10 第一格：少录点 6、多录点 1 → 即时标出缺失点与多余点
    await toggleDots(page, '10', 0, [3, 4, 5, 1])
    const firstCell = reviewRow(page, '10').getByTestId('review-cell').nth(0)
    await expect(firstCell.getByTestId('cell-diff')).toHaveText('缺 6 · 多 1')
    await expect(firstCell.locator('.rdot-missing')).toHaveCount(1)
    await expect(firstCell.locator('.rdot-extra')).toHaveCount(1)
    // 尚有格未录入 → 楼层仍为待核对
    await expect(
      reviewRow(page, '10').getByTestId('review-status'),
    ).toHaveText('待核对')

    // 其余格录满后 → 不吻合
    await toggleDots(page, '10', 1, [1])
    await toggleDots(page, '10', 2, [2, 4, 5])
    await expect(
      reviewRow(page, '10').getByTestId('review-status'),
    ).toHaveText('不吻合')
    await expect(page.getByTestId('count-mismatch')).toHaveText('1')
    await expect(page.getByTestId('count-pending')).toHaveText('1')

    // 修正：去掉多余的点 1、补上缺失的点 6 → 转为吻合
    await toggleDots(page, '10', 0, [1, 6])
    await expect(
      reviewRow(page, '10').getByTestId('review-status'),
    ).toHaveText('吻合')
    await expect(firstCell.getByTestId('cell-diff')).toHaveText('一致')
    await expect(page.getByTestId('count-match')).toHaveText('2')
    await expect(page.getByTestId('count-mismatch')).toHaveText('0')
  })
})

test.describe('实物逐点复核：离开页面后继续当前批次进度', () => {
  test('刷新后重新输入同一批次，复核进度从 localStorage 恢复', async ({
    page,
  }) => {
    await gotoApp(page)
    await enterReview(page, '1\nB1')
    await enterFloorCorrectly(page, '1', FLOOR_1_CELLS)
    await expect(reviewRow(page, '1').getByTestId('review-status')).toHaveText(
      '吻合',
    )

    // 进度确已写入 localStorage
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      REVIEW_STORAGE_KEY,
    )
    expect(stored).toBeTruthy()
    expect(JSON.parse(stored ?? '').records['1']).toEqual({
      0: [3, 4, 5, 6],
      1: [1],
    })

    // 离开页面（刷新）后重新输入同一批次：进度恢复
    await page.reload()
    await page.getByTestId('floor-input').waitFor()
    await enterReview(page, '1\nB1')

    await expect(reviewRow(page, '1').getByTestId('review-status')).toHaveText(
      '吻合',
    )
    await expect(page.getByTestId('count-match')).toHaveText('1')
    await expect(page.getByTestId('count-pending')).toHaveText('1')
    // 已录入的凸点保持按下状态
    const cell0 = reviewRow(page, '1').getByTestId('review-cell').nth(0)
    await expect(cell0.getByTestId('dot-3')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(cell0.getByTestId('dot-2')).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    // 无损坏提示
    await expect(page.getByTestId('storage-notice')).toHaveCount(0)
  })
})

test.describe('实物逐点复核：排列切换只改变展示顺序', () => {
  test('切换楼层顺序后，复核记录仍绑定原楼层', async ({ page }) => {
    await gotoApp(page)
    await enterReview(page, '1\nB1\n10')
    await enterFloorCorrectly(page, 'B1', FLOOR_B1_CELLS)
    await expect(
      reviewRow(page, 'B1').getByTestId('review-status'),
    ).toHaveText('吻合')

    // 切到楼层顺序：B1 排到第一行，吻合状态随楼层移动而非留在原行位置
    await page.getByTestId('order-floor').check()
    const rows = page.getByTestId('review-row')
    await expect(rows.nth(0)).toHaveAttribute('data-code', 'B1')
    await expect(
      rows.nth(0).getByTestId('review-status'),
    ).toHaveText('吻合')
    await expect(
      rows.nth(1).getByTestId('review-status'),
    ).toHaveText('待核对')
    await expect(page.getByTestId('count-match')).toHaveText('1')

    // 切回输入顺序：B1 回到第二行，记录不变
    await page.getByTestId('order-input').check()
    await expect(rows.nth(1)).toHaveAttribute('data-code', 'B1')
    await expect(
      rows.nth(1).getByTestId('review-status'),
    ).toHaveText('吻合')
  })
})

test.describe('实物逐点复核：异常存储的安全处理', () => {
  test('损坏存储被安全忽略、给出提示且不污染编码预览，可重新复核', async ({
    page,
  }) => {
    await gotoApp(page)
    await page.evaluate(
      (key) => window.localStorage.setItem(key, 'corrupted-not-json{{'),
      REVIEW_STORAGE_KEY,
    )

    await enterReview(page, SAMPLE)

    // 可见提示：进度已损坏被放弃
    const notice = page.getByTestId('storage-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('损坏')

    // 编码预览未被污染：三行结果与盲文串保持正确
    await expect(page.getByTestId('result-row')).toHaveCount(3)
    const strings = page.getByTestId('braille-string')
    await expect(strings.nth(0)).toHaveText('⠼⠁')
    await expect(strings.nth(1)).toHaveText('⠼⠁⠚')
    await expect(strings.nth(2)).toHaveText('⠠⠃⠼⠁')

    // 全部回到待核对，可重新逐点复核
    await expect(page.getByTestId('count-pending')).toHaveText('3')
    await enterFloorCorrectly(page, '1', FLOOR_1_CELLS)
    await expect(reviewRow(page, '1').getByTestId('review-status')).toHaveText(
      '吻合',
    )

    // 损坏内容已被合法进度覆盖
    const stored = await page.evaluate(
      (key) => window.localStorage.getItem(key),
      REVIEW_STORAGE_KEY,
    )
    expect(() => JSON.parse(stored ?? '')).not.toThrow()
    expect(JSON.parse(stored ?? '').records['1']).toBeDefined()
  })

  test('版本不识别的存储同样被放弃并提示', async ({ page }) => {
    await gotoApp(page)
    await page.evaluate(
      (key) =>
        window.localStorage.setItem(
          key,
          JSON.stringify({ version: 99, batch: [], records: {} }),
        ),
      REVIEW_STORAGE_KEY,
    )

    await enterReview(page, SAMPLE)
    const notice = page.getByTestId('storage-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('版本不识别')
    await expect(page.getByTestId('count-pending')).toHaveText('3')
  })

  test('修正输入后仅恢复代码与单元结构完全一致的记录', async ({ page }) => {
    await gotoApp(page)
    await enterReview(page, SAMPLE)
    await enterFloorCorrectly(page, '1', FLOOR_1_CELLS)
    await enterFloorCorrectly(page, 'B1', FLOOR_B1_CELLS)
    await expect(page.getByTestId('count-match')).toHaveText('2')

    // 输入改坏：复核面板随结果一起隐藏，编码预览只报非法行
    await page.getByTestId('floor-input').fill('1\n100\nB1')
    await expect(page.getByTestId('error-panel')).toBeVisible()
    await expect(page.getByTestId('review-panel')).toHaveCount(0)

    // 修正为去掉 B1 的批次：1 的记录恢复，B1 记录被放弃并提示
    await page.getByTestId('floor-input').fill('1\n10')
    await expect(page.getByTestId('review-panel')).toBeVisible()
    await expect(reviewRow(page, '1').getByTestId('review-status')).toHaveText(
      '吻合',
    )
    await expect(
      reviewRow(page, '10').getByTestId('review-status'),
    ).toHaveText('待核对')
    const notice = page.getByTestId('storage-notice')
    await expect(notice).toBeVisible()
    await expect(notice).toContainText('B1')

    // 再补回 B1：被放弃的记录不会复活，需要重新复核
    await page.getByTestId('floor-input').fill(SAMPLE)
    await expect(
      reviewRow(page, 'B1').getByTestId('review-status'),
    ).toHaveText('待核对')
  })
})
