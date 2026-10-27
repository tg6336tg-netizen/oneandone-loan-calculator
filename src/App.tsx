import { lazy, Suspense, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

const RegistryAnalysis = lazy(() => import('./RegistryAnalysis'))

const policies = {
  seoulApartment: { label: '서울 아파트', ltv: 72 },
  otherApartment: { label: '서울 제외 전국 아파트', ltv: 68 },
  metropolitanVilla: { label: '수도권 빌라 (서울·경기·인천)', ltv: 50 },
} as const
type PropertyType = keyof typeof policies
const annualRate = 18

const won = new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW' })

function App() {
  const [propertyValue, setPropertyValue] = useState('50000')
  const [propertyType, setPropertyType] = useState<PropertyType>('seoulApartment')
  const [debtBasis, setDebtBasis] = useState<'principal' | 'maximum'>('principal')
  const [creditScore, setCreditScore] = useState('600')
  const ltv = policies[propertyType].ltv
  const debtLabel = debtBasis === 'principal' ? '선순위 대출 원금' : '선순위 채권최고액'
  const [existingDebt, setExistingDebt] = useState('10000')
  const [result, setResult] = useState<{ limit: number; monthlyInterest: number; eligible: boolean } | null>(null)

  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = Number(propertyValue)
    const ratio = ltv
    const score = Number(creditScore)
    const debt = Number(existingDebt)
    if (![value, ratio, debt, score].every(Number.isFinite) || !Number.isSafeInteger(value) || !Number.isSafeInteger(Math.round(debt * 10000)) || !Number.isInteger(score) || value <= 0 || value > 100000000 || debt < 0 || debt > 100000000 || score < 0 || score > 1000) return
    const eligible = score >= 600
    const limit = eligible ? Math.max(0, value * 100 * ratio - Math.round(debt * 10000)) : 0
    setResult({ limit, monthlyInterest: Math.round(limit * annualRate / 100 / 12), eligible })
  }

  return (
    <main>
      <header><a className="brand" href="/">원앤원<span>자산관리대부</span></a><span className="badge">부동산 금융</span></header>
      <section className="intro">
        <p className="eyebrow">LOAN CALCULATOR</p>
        <h1>내 부동산의 가능성,<br />예상 한도를 확인하세요.</h1>
        <p>담보 유형과 선순위 대출, 신용점수를 입력해 내부 검토용 한도와 월 이자를 확인하세요.</p>
      </section>
      <Suspense fallback={<p role="status">등기부 분석 도구를 불러오는 중…</p>}>
        <RegistryAnalysis onApply={amount => { setDebtBasis('maximum'); setExistingDebt(String(amount / 10000)); setResult(null) }} onInvalidate={() => { setExistingDebt(''); setResult(null) }} />
      </Suspense>
      <div className="calculator">
        <section className="panel">
          <h2>담보 정보 입력</h2><p className="muted">금액은 만원 단위로 입력해 주세요.</p>
          <form onSubmit={calculate} onChange={() => setResult(null)}>
            <label htmlFor="property-type">담보 유형 및 지역</label>
            <select id="property-type" value={propertyType} onChange={e => setPropertyType(e.target.value as PropertyType)}>
              {Object.entries(policies).map(([key, policy]) => <option key={key} value={key}>{policy.label} · LTV {policy.ltv}%</option>)}
            </select>
            <p className="policy-note">적용 LTV {ltv}% · 기본 연금리 {annualRate}% · 신용점수 600점 이상</p>
            <label htmlFor="value">부동산 담보가액 (만원)</label>
            <input id="value" type="number" min="1" max="100000000" step="1" required value={propertyValue} onChange={e => setPropertyValue(e.target.value)} />
            <label htmlFor="debt-basis">선순위 차감 기준</label>
            <select id="debt-basis" value={debtBasis} onChange={e => { setDebtBasis(e.target.value as 'principal' | 'maximum'); setExistingDebt('') }}>
              <option value="principal">대출 원금 기준</option>
              <option value="maximum">채권최고액 기준</option>
            </select>
            <label htmlFor="debt">{debtLabel} (만원)</label>
            <input id="debt" type="number" min="0" max="100000000" step="0.0001" required value={existingDebt} onChange={e => setExistingDebt(e.target.value)} />
            <p className="policy-note">{debtBasis === 'principal' ? '선순위 대출의 실제 원금 잔액을 입력하세요.' : '등기상 선순위 채권최고액을 직접 입력하세요. 원금에 임의 배율을 적용하지 않습니다.'}</p>
            <label htmlFor="credit-score">신용점수 (0~1000점)</label>
            <input id="credit-score" type="number" min="0" max="1000" step="1" required value={creditScore} onChange={e => setCreditScore(e.target.value)} />
            <button type="submit">예상 한도 계산하기 <span aria-hidden="true">↗</span></button>
          </form>
        </section>
        <section className="result" aria-live="polite" aria-atomic="true">
          <p className="eyebrow">ESTIMATED LIMIT</p><h2>예상 추가 대출 한도</h2>
          <p className="amount">{result === null ? '계산 전' : won.format(result.limit)}</p>
          <p>{result === null ? '담보 정보를 입력하고 계산 버튼을 눌러 주세요.' : result.eligible ? '입력하신 내부 기준을 적용한 예상 금액입니다.' : '신용점수 600점 미만으로 내부 검토 기준을 충족하지 않습니다.'}</p>
          <dl className="interest-summary">
            <div><dt>기본 연금리</dt><dd>{annualRate}%</dd></div>
            <div><dt>예상 월 이자</dt><dd data-testid="monthly-interest">{result === null ? '계산 전' : result.eligible ? won.format(result.monthlyInterest) : '산정 제외'}</dd></div>
          </dl>
          <div className="formula">담보가액 × LTV {ltv}% − {debtLabel}<br />추가 한도는 최소 0원이며 신용점수 600점 이상에 적용합니다.<br />월 이자 = 추가 대출 한도 × 연 {annualRate}% ÷ 12 (원 단위 반올림)<br />한도 전액 대출을 가정한 이자이며 원금 상환액은 포함하지 않습니다.</div>
          <p className="review-notice">계산 결과는 내부 검토용이며 실제 대출 승인은 별도 심사가 필요합니다.</p>
        </section>
      </div>
      <aside><strong>이용 안내</strong><p>제공된 내부 심사 기준(서울 아파트 72%, 서울 제외 전국 아파트 68%, 수도권 빌라 50%)을 적용합니다. 수도권 외 빌라 등 명시되지 않은 담보 유형은 계산 대상에서 제외합니다. 계산 결과는 내부 검토용이며 실제 대출 승인은 별도 심사가 필요합니다. 실제 대출 한도는 담보 평가, 지역, 대출 규제, 신용도 및 심사 결과에 따라 달라질 수 있습니다. 입력 정보는 서버로 전송하거나 저장하지 않습니다.</p></aside>
      <footer>원앤원자산관리대부 · 부동산 담보대출 한도 계산기</footer>
    </main>
  )
}

export default App
