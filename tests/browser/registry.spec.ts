import { test, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { mortgageText } from '../fixtures/registry'

test('text PDF: local extraction, approval gate, exact won transfer and existing calculator', async ({ page, context }) => {
  const maker = await context.newPage()
  await maker.setContent('<style>pre {font: 16px "Noto Sans CJK KR", sans-serif; line-height: 2}</style><pre></pre>')
  await maker.locator('pre').textContent() // Ensure the document exists before preparing the fixture.
  await maker.locator('pre').evaluate((element, value) => { element.textContent = value }, mortgageText)
  const pdf = await maker.pdf({ format: 'A4' }); await maker.close()
  const outgoing: string[] = []; const errors: string[] = []
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4180/') && !request.url().startsWith('blob:')) outgoing.push(request.url()) })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('./')
  for (const [type, amount, interest] of [['seoulApartment', '260,000,000', '3,900,000'], ['otherApartment', '240,000,000', '3,600,000'], ['metropolitanVilla', '150,000,000', '2,250,000']]) {
    await page.locator('#property-type').selectOption(type)
    await page.getByRole('button', { name: '예상 한도 계산하기' }).click()
    await expect(page.locator('.amount')).toContainText(amount)
    await expect(page.getByTestId('monthly-interest')).toContainText(interest)
  }
  await page.locator('#credit-score').fill('599')
  await page.getByRole('button', { name: '예상 한도 계산하기' }).click()
  await expect(page.getByTestId('monthly-interest')).toHaveText('산정 제외')
  await page.locator('#credit-score').fill('600')
  await page.locator('#property-type').selectOption('seoulApartment')
  await page.locator('#registry-file').setInputFiles({ name: 'synthetic-text.pdf', mimeType: 'application/pdf', buffer: pdf })
  await expect(page.locator('.right-card')).toHaveCount(3)
  await expect(page.getByRole('button', { name: '승인한 채권최고액을 계산기에 반영' })).toBeDisabled()
  const cards = page.locator('.right-card')
  for (let i = 0; i < await cards.count(); i++) {
    const card = cards.nth(i)
    if (await card.getByLabel('권리 분류').inputValue() === 'unknown') await card.getByLabel('이 권리를 합계/연결 처리에서 제외', { exact: false }).check()
    await card.getByLabel('원문·금액·순위·변경 연결', { exact: false }).check()
  }
  await page.locator('#planned-rank').fill('2')
  await page.getByLabel('전체 페이지와 말소·변경 이력', { exact: false }).check()
  await expect(page.locator('.registry-total')).toContainText('120,000,001원')
  await page.getByRole('button', { name: '승인한 채권최고액을 계산기에 반영' }).click()
  await expect(page.locator('#debt-basis')).toHaveValue('maximum')
  await expect(page.locator('#debt')).toHaveValue('12000.0001')
  await page.getByRole('button', { name: '예상 한도 계산하기' }).click()
  await expect(page.locator('.amount')).toContainText('239,999,999')
  await page.locator('#planned-rank').fill('4')
  await expect(page.locator('#debt')).toHaveValue('')
  for (const width of [375, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  }
  expect(await page.evaluate(async () => ({ local: localStorage.length, session: sessionStorage.length, databases: (await indexedDB.databases()).length }))).toEqual({ local: 0, session: 0, databases: 0 })
  expect(outgoing).toEqual([]); expect(errors).toEqual([])
})

test('image-only scan PDF executes real local Korean/English OCR without external requests', async ({ page, context }) => {
  const maker = await context.newPage({ viewport: { width: 1000, height: 900 } })
  await maker.setContent('<style>body{background:white;color:black;padding:40px;font:32px "Noto Sans CJK KR", sans-serif;line-height:2}</style><div>SCANNED REGISTRY TEST</div><div>을구</div><div>1 근저당권설정</div><div>채권최고액 금120,000,000원</div><div>근저당권자 예시은행</div>')
  const image = await maker.screenshot(); await maker.close()
  const pdf = await PDFDocument.create(); const png = await pdf.embedPng(image)
  pdf.addPage([1000, 900]).drawImage(png, { x: 0, y: 0, width: 1000, height: 900 })
  const requests: string[] = []
  context.on('request', request => requests.push(request.url()))
  await page.goto('./')
  await page.locator('#registry-file').setInputFiles({ name: 'synthetic-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) })
  await expect(page.locator('.registry-panel [role=status]')).toContainText('권리 후보를 추출', { timeout: 150000 })
  await expect(page.locator('.right-card').first()).toContainText('OCR')
  await page.getByText('텍스트 수동 입력 / 추출 원문 확인', { exact: true }).click()
  await expect(page.locator('.registry-panel pre').first()).toContainText('SCANNED')
  expect(requests.some(url => url.includes('kor.traineddata.gz'))).toBe(true)
  expect(requests.some(url => url.includes('tesseract-core'))).toBe(true)
  expect(requests.filter(url => !url.startsWith('http://127.0.0.1:4180/') && !url.startsWith('blob:'))).toEqual([])
  expect(await page.evaluate(async () => (await indexedDB.databases()).length)).toBe(0)
})

test('bad PDF and parse failure leave manual fallback; reset removes document state', async ({ page }) => {
  await page.goto('./')
  await page.locator('#registry-file').setInputFiles({ name: 'bad.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') })
  await expect(page.locator('.registry-panel [role=status]')).toContainText('실패')
  await page.getByText('텍스트 수동 입력 / 추출 원문 확인', { exact: true }).click()
  await page.locator('#manual-registry').fill('판독 불가능한 텍스트')
  await page.getByRole('button', { name: '수동 텍스트로 다시 분석', exact: false }).click()
  await expect(page.locator('.right-card')).toHaveCount(0)
  await page.getByRole('button', { name: '권리 수동 추가', exact: true }).click()
  await expect(page.locator('.right-card')).toHaveCount(1)
  await page.getByRole('button', { name: '분석 취소 / 초기화' }).click()
  await expect(page.locator('.right-card')).toHaveCount(0)
  await expect(page.locator('#manual-registry')).toHaveValue('')
})

test('OCR language failure and cancellation terminate cleanly and allow manual fallback', async ({ page }) => {
  const pdf = await PDFDocument.create(); pdf.addPage([300, 300])
  const fixture = { name: 'synthetic-blank-scan.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) }
  await page.route('**/lang/*.traineddata.gz', route => route.abort())
  await page.goto('./')
  await page.locator('#registry-file').setInputFiles(fixture)
  await expect(page.locator('.registry-panel [role=status]')).toContainText('실패', { timeout: 30000 })
  await page.getByRole('button', { name: '권리 수동 추가', exact: true }).click()
  await expect(page.locator('.right-card')).toHaveCount(1)
  await page.unroute('**/lang/*.traineddata.gz')
  await page.locator('#registry-file').setInputFiles(fixture)
  await page.getByRole('button', { name: '분석 취소 / 초기화' }).click()
  await expect(page.locator('.right-card')).toHaveCount(0)
  await expect(page.locator('.registry-panel [role=status]')).toHaveText('')
  await expect(page.getByRole('button', { name: '권리 수동 추가', exact: true })).toBeEnabled()
})
