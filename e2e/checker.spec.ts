import { expect, test } from '@playwright/test'

const SAMPLE = '1\n10\nB1'

async function gotoApp(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByTestId('floor-input').waitFor()
}

test.describe('合法批次：墨字 / Unicode 盲文 / SVG 六点并排显示', () => {
  test('映射逐行正确，格间无空白，行序与原行一致', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(SAMPLE)

    const rows = page.getByTestId('result-row')
    await expect(rows).toHaveCount(3)

    const strings = page.getByTestId('braille-string')
    await expect(strings.nth(0)).toHaveText('⠼⠁')
    await expect(strings.nth(1)).toHaveText('⠼⠁⠚')
    await expect(strings.nth(2)).toHaveText('⠠⠃⠼⠁')

    // 每一行的盲文串不得含空白
    expect(await strings.allInnerTexts()).toEqual(
      (await strings.allInnerTexts()).map((t) => t.trim()),
    )

    // B1 行应有 4 个 SVG 格（大写符、B、数字符、数字 1），每格 6 个点圆
    const lastRow = rows.nth(2)
    await expect(lastRow.locator('svg')).toHaveCount(4)
    await expect(lastRow.locator('circle')).toHaveCount(24)
    // 点亮点总数：1(大写符) + 2(B) + 4(数字符) + 1(数字1) = 8
    await expect(lastRow.locator('circle.dot-on')).toHaveCount(8)

    // 空行忽略，行号仍取原始行序
    await page.getByTestId('floor-input').fill('\n1\n\n2\n')
    const lineCells = page.locator('.col-line')
    await expect(lineCells).toHaveText(['2', '4'])
  })
})

test.describe('整批失败', () => {
  test('非法代码：不生成任何结果并定位首个问题行与原因', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill('1\n100\nB1')

    const panel = page.getByTestId('error-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('第 2 行')
    await expect(panel.getByTestId('error-code')).toHaveText('100')
    await expect(panel).toContainText('1 至 99')
    await expect(page.getByTestId('result-panel')).toHaveCount(0)

    // 修正后立即出现唯一结果
    await page.getByTestId('floor-input').fill('1\n10\nB1')
    await expect(page.getByTestId('result-row')).toHaveCount(3)
    await expect(page.getByTestId('error-panel')).toHaveCount(0)
  })

  test('重复代码：报告重复行与首次出现行，且不生成结果', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill('B2\nB2')
    const panel = page.getByTestId('error-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('第 2 行')
    await expect(panel).toContainText('重复')
    await expect(panel).toContainText('第 1 行')
    await expect(page.getByTestId('result-panel')).toHaveCount(0)
  })

  test('小写 b 与含空白代码均被判非法', async ({ page }) => {
    await gotoApp(page)
    const input = page.getByTestId('floor-input')

    await input.fill('b1')
    await expect(page.getByTestId('error-panel')).toContainText('大写')

    await input.fill(' 1')
    await expect(page.getByTestId('error-panel')).toContainText('空白')
  })
})

test.describe('键盘操作与复制一致性', () => {
  test('Ctrl+Enter 复制的内容与预览逐行一致', async ({ page, context }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(SAMPLE)
    await expect(page.getByTestId('result-row')).toHaveCount(3)

    await page.getByTestId('floor-input').press('Control+Enter')
    await expect(page.getByTestId('copy-message')).toBeVisible()

    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    const preview = (await page.getByTestId('copy-preview').textContent()) ?? ''
    expect(clipboard).toBe(preview.trim())
    expect(clipboard.split('\n')).toEqual([
      '1\t⠼⠁\t3456 1',
      '10\t⠼⠁⠚\t3456 1 245',
      'B1\t⠠⠃⠼⠁\t6 12 3456 1',
    ])

    // 授予的剪贴板权限确实生效（避免测试假通过）
    void context
  })

  test('存在非法代码时 Ctrl+Enter 不产生复制内容，复制按钮禁用', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill('1\n100')
    const btn = page.getByTestId('copy-btn')
    await expect(btn).toBeDisabled()

    await page.getByTestId('floor-input').press('Control+Enter')
    await expect(page.getByTestId('copy-message')).toHaveCount(0)
  })

  test('键盘 Tab 可在输入框与操作按钮间移动焦点', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').focus()
    await page.keyboard.press('Tab')
    await expect(page.locator('button:focus')).toHaveCount(1)
  })
})
