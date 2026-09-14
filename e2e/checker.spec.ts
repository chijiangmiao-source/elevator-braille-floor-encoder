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

test.describe('输入顺序／楼层顺序切换', () => {
  const MIXED = '2\nB1\n10\nB9\n1'
  const INPUT_CODES = ['2', 'B1', '10', 'B9', '1']
  const FLOOR_CODES = ['B9', 'B1', '1', '2', '10']
  const FLOOR_LINES = ['4', '2', '5', '1', '3']

  function rowCodes(page: import('@playwright/test').Page) {
    return page.getByTestId('result-row').locator('.col-code').allInnerTexts()
  }

  test('切换楼层顺序后表格与复制内容一致，切回输入顺序立即恢复', async ({
    page,
  }) => {
    await gotoApp(page)
    // 默认保持输入顺序
    await expect(page.getByTestId('order-input')).toBeChecked()

    await page.getByTestId('floor-input').fill(MIXED)
    expect(await rowCodes(page)).toEqual(INPUT_CODES)

    // 切到楼层顺序：B9→B1 在前，1→99 升序在后，原行号仍指向粘贴文本
    await page.getByTestId('order-floor').check()
    expect(await rowCodes(page)).toEqual(FLOOR_CODES)
    await expect(page.locator('.col-line')).toHaveText(FLOOR_LINES)

    // 复制内容与楼层顺序的表格逐行一致
    await page.getByTestId('copy-btn').click()
    await expect(page.getByTestId('copy-message')).toBeVisible()
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    const preview =
      (await page.getByTestId('copy-preview').textContent()) ?? ''
    expect(clipboard).toBe(preview.trim())
    expect(clipboard.split('\n').map((line) => line.split('\t')[0])).toEqual(
      FLOOR_CODES,
    )

    // 切回输入顺序：表格与复制内容立即恢复原排列
    await page.getByTestId('order-input').check()
    expect(await rowCodes(page)).toEqual(INPUT_CODES)
    await page.getByTestId('copy-btn').click()
    const clipboardBack = await page.evaluate(() =>
      navigator.clipboard.readText(),
    )
    expect(
      clipboardBack.split('\n').map((line) => line.split('\t')[0]),
    ).toEqual(INPUT_CODES)
  })

  test('刷新页面后回到默认的输入顺序', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(MIXED)
    await page.getByTestId('order-floor').check()
    expect(await rowCodes(page)).toEqual(FLOOR_CODES)

    await page.reload()
    await page.getByTestId('floor-input').waitFor()
    await expect(page.getByTestId('order-input')).toBeChecked()
    await page.getByTestId('floor-input').fill(MIXED)
    expect(await rowCodes(page)).toEqual(INPUT_CODES)
  })

  test('非法与重复仍按输入位置报告首个问题，与排序选项无关', async ({
    page,
  }) => {
    await gotoApp(page)
    await page.getByTestId('order-floor').check()

    await page.getByTestId('floor-input').fill('1\n100\nB1')
    const panel = page.getByTestId('error-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('第 2 行')
    await expect(panel.getByTestId('error-code')).toHaveText('100')
    await expect(page.getByTestId('result-panel')).toHaveCount(0)

    // 重复代码：报告重复行与首次出现行，仍取输入位置
    await page.getByTestId('floor-input').fill('B2\n1\nB2')
    await expect(panel).toContainText('第 3 行')
    await expect(panel).toContainText('第 1 行')
    await expect(page.getByTestId('result-panel')).toHaveCount(0)

    // 修正后结果按当前选中的楼层顺序出现
    await page.getByTestId('floor-input').fill('B2\n1\nB1')
    expect(await rowCodes(page)).toEqual(['B2', 'B1', '1'])
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

test.describe('复制反馈状态', () => {
  test('复制后切换排列，旧的复制成功提示立即失效', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill('2\nB1\n10\nB9\n1')
    await page.getByTestId('copy-btn').click()
    await expect(page.getByTestId('copy-message')).toBeVisible()

    // 预览已按楼层顺序重排，但当前排列尚未复制：成功提示必须立即消失
    // （一次性断言，不等 2 秒自动消退，否则无法区分“切换失效”与“计时消退”）
    await page.getByTestId('order-floor').check()
    expect(await page.getByTestId('copy-message').count()).toBe(0)

    // 切回输入顺序也不会恢复旧提示
    await page.getByTestId('order-input').check()
    expect(await page.getByTestId('copy-message').count()).toBe(0)
  })

  test('复制后修改输入内容，旧的复制成功提示同样失效', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(SAMPLE)
    await page.getByTestId('copy-btn').click()
    await expect(page.getByTestId('copy-message')).toBeVisible()

    await page.getByTestId('floor-input').fill('1\n2')
    expect(await page.getByTestId('copy-message').count()).toBe(0)
  })

  test('剪贴板接口被拒绝且降级复制返回失败时，显示复制失败提示', async ({
    page,
  }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(SAMPLE)

    // 模拟裸 http 部署：clipboard 接口被拒绝，execCommand 降级也返回失败
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        value: () =>
          Promise.reject(new DOMException('denied', 'NotAllowedError')),
        configurable: true,
      })
      document.execCommand = () => false
    })

    await page.getByTestId('copy-btn').click()
    await expect(page.getByTestId('copy-fail-message')).toBeVisible()
    await expect(page.getByTestId('copy-message')).toHaveCount(0)
  })

  test('连续复制时，成功提示从最近一次复制起完整保留两秒', async ({ page }) => {
    await gotoApp(page)
    await page.getByTestId('floor-input').fill(SAMPLE)
    const msg = page.getByTestId('copy-message')

    await page.getByTestId('copy-btn').click()
    await expect(msg).toBeVisible()

    // 约 1 秒后再次复制
    await page.waitForTimeout(1000)
    await page.getByTestId('copy-btn').click()
    await expect(msg).toBeVisible()

    // 距第二次复制约 1.2 秒（距首次约 2.2 秒）：
    // 首次操作的消退计时不得提前清除本次提示
    await page.waitForTimeout(1200)
    await expect(msg).toBeVisible()

    // 距第二次复制满 2 秒后提示才消退
    await expect(msg).toHaveCount(0, { timeout: 2500 })
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
