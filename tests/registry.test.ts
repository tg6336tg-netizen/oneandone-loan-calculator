import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRegistry, parseWon, reviewTotal } from '../src/registry.ts'
import type { RegistryRight } from '../src/registry.ts'
import { mortgageText, cancellation, amendment } from './fixtures/registry.ts'

const parse = (text: string) => parseRegistry([{ page: 2, text, source: 'text' }])
const confirm = (rights: RegistryRight[]) => rights.map(r => ({ ...r, confirmed: true, excluded: r.kind === 'unknown' }))

test('원/만원/억원 parsing rejects OCR guesses and unknown units', () => {
  for (const [text, expected] of [['금120,000,001원', 120000001], ['12000만원', 120000000], ['1억원', 100000000], ['1억2000만원', 120000000], ['2천만원', 20000000]] as const) assert.equal(parseWon(text), expected)
  for (const text of ['12O,000,000원', '일억원', '1.2억원', '100달러', '-100원', '']) assert.equal(parseWon(text), null)
})

test('extract source page, receipt, holder; sum by numeric priority, not input order', () => {
  const rights = parse(mortgageText)
  assert.equal(rights.length, 3)
  const first = rights.find(r => r.rank === '1' && r.section === '을구')!
  assert.equal(first.page, 2); assert.equal(first.date, '2024-01-02'); assert.equal(first.receipt, '100')
  assert.equal(first.holder, '예시선순위은행'); assert.match(first.raw, /120,000,001/)
  assert.equal(reviewTotal(rights, '2').total, 0)
  const checked = confirm(rights)
  assert.deepEqual(reviewTotal(checked, '2').errors, [])
  assert.equal(reviewTotal(checked, '2').total, 120000001)
  assert.equal(reviewTotal(checked, '4').total, 210000001)
})

test('only a reviewed full cancellation with an unambiguous target excludes a mortgage', () => {
  const rights = confirm(parse(mortgageText + '\n' + cancellation))
  const cancel = rights.find(r => r.kind === 'cancel')!
  assert.equal(cancel.targetRank, '1')
  assert.equal(reviewTotal(rights, '5').total, 90000000)
  assert.ok(reviewTotal(rights.map(r => r.id === cancel.id ? { ...r, confirmed: false } : r), '5').errors.length)
  assert.ok(reviewTotal(rights.map(r => r.id === cancel.id ? { ...r, targetRank: '99' } : r), '5').errors.length)
})

test('reductions, increases, partial cancellation and joint collateral require manual reconciliation', () => {
  for (const purpose of ['변경', '감액', '증액', '일부말소']) {
    const rights = confirm(parse(mortgageText + '\n' + amendment(purpose)))
    const change = rights.find(r => r.kind === 'change')!
    assert.equal(change.targetRank, '1')
    assert.ok(reviewTotal(rights, '4').errors.some(e => e.includes('수정')))
    const reconciled = rights.map(r => r.id === change.id ? { ...r, excluded: true } : r.section === '을구' && r.rank === '1' ? { ...r, amount: '80000000' } : r)
    assert.deepEqual(reviewTotal(reconciled, '4').errors, [])
    assert.equal(reviewTotal(reconciled, '4').total, 170000000)
  }
  const partial = confirm(parse(mortgageText + '\n' + amendment('일부말소'))).map(r => r.kind === 'change' ? { ...r, kind: 'cancel' as const } : r)
  assert.ok(reviewTotal(partial, '4').errors.some(e => e.includes('일부말소')))
  assert.ok(parse(mortgageText + '\n공동담보목록 제1호').some(r => r.warnings.some(w => w.includes('공동담보'))))
})

test('OCR uncertainty, missing amount, duplicate rank, missing section and parse failure never auto-approve', () => {
  const ocr = parseRegistry([{ page: 3, source: 'ocr', confidence: 48, text: '을구\n1 근저당권설정\n채권최고액 금12O,000,000원' }])
  assert.equal(ocr[0].amount, ''); assert.match(ocr[0].confidence, /48%/)
  assert.ok(reviewTotal(confirm(ocr), '2').errors.length)
  const duplicates = confirm(parse('을구\n1 근저당권설정\n채권최고액 금100원\n1 근저당권설정\n채권최고액 금200원'))
  assert.ok(reviewTotal(duplicates, '2').errors.some(e => e.includes('중복')))
  assert.ok(reviewTotal(confirm(parse('1 근저당권설정\n채권최고액 금100원')), '2').errors.length)
  assert.ok(reviewTotal(confirm(parse('갑구\n1 근저당권설정\n채권최고액 금100원')), '2').errors.some(e => e.includes('갑구/을구')))
  assert.equal(parse('인식할 수 없는 문서').length, 0)
  assert.ok(reviewTotal([], '2').errors.length)
  assert.ok(reviewTotal(confirm(parse(mortgageText)), '2.5').errors.length)
})

test('risk rights persist as review items and transfer does not duplicate a debt', () => {
  const rights = confirm(parse(mortgageText + '\n갑구\n2 가압류\n권리자 예시채권자\n을구\n1-1 1번근저당권이전\n근저당권자 새은행'))
  assert.ok(rights.some(r => r.kind === 'risk'))
  assert.equal(reviewTotal(rights, '4').total, 210000001)
  assert.deepEqual(reviewTotal(rights, '4').errors, [])
})

test('multiple cancellation targets and incomplete evidence require explicit correction', () => {
  const rights = confirm(parse(mortgageText + '\n을구\n4 1번및3번근저당권설정등기말소'))
  const cancellation = rights.find(r => r.kind === 'cancel')!
  assert.equal(cancellation.targetRank, '')
  assert.ok(cancellation.warnings.some(w => w.includes('복수 연결')))
  assert.ok(reviewTotal(rights, '5').errors.some(e => e.includes('연결')))
  const incomplete = confirm(parse(mortgageText)).map(r => ({ ...r, raw: '', page: 0 }))
  assert.ok(reviewTotal(incomplete, '5').errors.some(e => e.includes('근거')))
})
