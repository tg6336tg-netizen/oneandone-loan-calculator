import { useEffect, useRef, useState } from 'react'
import { parseRegistry, reviewTotal } from './registry'
import type { RegistryPage, RegistryRight } from './registry'
import { readRegistryPdf } from './readRegistryPdf'
import './RegistryAnalysis.css'

const kinds: Record<RegistryRight['kind'], string> = { mortgage: '근저당 설정', change: '변경/감액/증액/일부말소', transfer: '근저당 이전', cancel: '전부말소 (원문 확인 필수)', risk: '압류/가압류/가처분/경매 등 위험', unknown: '분류 확인 필요' }
const currency = new Intl.NumberFormat('ko-KR')

export default function RegistryAnalysis({ onApply, onInvalidate }: { onApply: (amount: number) => void; onInvalidate: () => void }) {
  const [pages, setPages] = useState<RegistryPage[]>([])
  const [rights, setRights] = useState<RegistryRight[]>([])
  const [plannedRank, setPlannedRank] = useState('')
  const [coverage, setCoverage] = useState(false)
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [applied, setApplied] = useState(false)
  const [pdfUrl, setPdfUrl] = useState('')
  const [manual, setManual] = useState('')
  const task = useRef<AbortController | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => () => { task.current?.abort() }, [])
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl) }, [pdfUrl])
  function invalidate() {
    if (applied) onInvalidate()
    setApplied(false)
  }
  function reset() {
    task.current?.abort(); task.current = null
    invalidate(); setPages([]); setRights([]); setCoverage(false); setPdfUrl(''); setManual(''); setStatus(''); setBusy(false)
    if (input.current) input.current.value = ''
  }
  async function upload(file: File) {
    reset()
    const controller = new AbortController(); task.current = controller
    setPdfUrl(URL.createObjectURL(file)); setBusy(true)
    try {
      const extracted = await readRegistryPdf(file, message => { if (!controller.signal.aborted) setStatus(message) }, controller.signal)
      if (controller.signal.aborted) return
      setPages(extracted)
      const parsed = parseRegistry(extracted); setRights(parsed)
      setStatus(parsed.length ? `${extracted.length}페이지에서 ${parsed.length}개 권리 후보를 추출했습니다. 원문 대조가 필요합니다.` : '권리 구조를 판독하지 못했습니다. 원문 확인 후 수동 입력하세요.')
    } catch {
      if (!controller.signal.aborted) setStatus('PDF/OCR 분석에 실패했습니다. 암호·파일 형식·로컬 자산 로드를 확인하고 원문을 보며 수동 입력하세요.')
    } finally { if (task.current === controller) { setBusy(false); task.current = null } }
  }
  function update(id: string, patch: Partial<RegistryRight>) {
    invalidate(); setCoverage(false)
    setRights(previous => previous.map(right => right.id === id ? { ...right, ...patch, confirmed: patch.confirmed ?? false } : right))
  }
  function addManual() {
    invalidate(); setCoverage(false)
    setRights(previous => [...previous, { id: `manual-${crypto.randomUUID()}`, section: '을구', rank: '', purpose: '', date: '', receipt: '', holder: '', amount: '', targetRank: '', kind: 'unknown', page: 1, raw: '', confidence: '수동 입력 · 미확인', warnings: ['원본 PDF와 대조 필요'], confirmed: false, excluded: false }])
  }
  const review = reviewTotal(rights, plannedRank)
  const riskPresent = rights.some(r => r.kind === 'risk' || /공동담보/.test(r.raw))
  return <section className="registry-panel" aria-labelledby="registry-heading">
    <h2 id="registry-heading">등기부등본 분석 · 선순위 권리 검토</h2>
    <p>PDF는 이 브라우저에서만 분석합니다. 파일·추출 정보는 외부 서버로 전송하거나 영구저장하지 않습니다. 페이지를 닫거나 초기화하면 삭제됩니다.</p>
    <p className="registry-warning">자동 추출은 검토 보조입니다. 등기상 채권최고액은 실제 대출 원금이 아닙니다. 임차인·보증금·세금 등 등기 외 위험은 별도로 검토하세요. 실제 대출 승인은 별도 심사가 필요합니다.</p>
    <label htmlFor="registry-file">등기부등본 PDF (25MB·30페이지 이하)</label>
    <input ref={input} id="registry-file" type="file" accept="application/pdf,.pdf" onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file) }} />
    <div className="registry-actions"><button type="button" onClick={reset}>분석 취소 / 초기화</button><button type="button" onClick={addManual} disabled={busy}>권리 수동 추가</button></div>
    <p role="status">{status}</p>
    {pdfUrl && <a className="registry-link" href={pdfUrl} target="_blank" rel="noreferrer">원본 PDF 열기 (페이지 대조)</a>}
    <details><summary>텍스트 수동 입력 / 추출 원문 확인</summary>
      {pages.map(page => <details key={page.page}><summary>{page.page}페이지 · {page.source === 'ocr' ? `OCR ${Math.round(page.confidence ?? 0)}%` : '텍스트'}</summary><pre>{page.text || '(텍스트 없음: 수동 확인 필요)'}</pre></details>)}
      <label htmlFor="manual-registry">페이지별 원문 (입력한 내용은 1페이지로 취급)</label>
      <textarea id="manual-registry" value={manual} onChange={e => setManual(e.target.value)} placeholder={'을구\n1 근저당권설정\n채권최고액 금120,000,000원\n근저당권자 예시은행'} />
      <button type="button" disabled={busy || !manual.trim()} onClick={() => {
        invalidate(); setCoverage(false)
        const extracted: RegistryPage[] = [{ page: 1, text: manual, source: 'manual' }]
        setPages(extracted); const parsed = parseRegistry(extracted); setRights(parsed)
        setStatus(`${parsed.length}개 권리 후보. 수동 입력은 PDF 전체를 대체하지 않으므로 누락을 확인하세요.`)
      }}>수동 텍스트로 다시 분석 (기존 검토 대체)</button>
    </details>
    {rights.length > 0 && <>
      <p className="registry-warning">갑구 위험권리와 공동담보는 별도 검토 대상입니다.{riskPresent ? ' 위험권리 또는 공동담보 문구가 발견되었습니다.' : ' 미검출이 위험 없음의 증거는 아닙니다.'} 변경/감액/증액·일부말소는 원 권리를 수동 수정한 후 해당 이력을 제외 승인하세요. 전부말소는 연결 대상을 확인·승인한 경우에만 합계에서 제외합니다.</p>
      <div className="rights-list">{rights.map((right, index) => <article className="right-card" key={right.id}>
        <h3>권리 {index + 1} · {right.section} {right.rank || '?'}번</h3>
        <p>{right.page}페이지 · {right.confidence}</p>
        <details><summary>원문 및 확인 필요 사유</summary><pre>{right.raw || '수동 입력: 원본에서 근거 문구를 입력하세요.'}</pre><ul>{right.warnings.map(w => <li key={w}>{w}</li>)}</ul></details>
        <div className="right-fields">
          <label>구분<select value={right.section} onChange={e => update(right.id, { section: e.target.value as RegistryRight['section'] })}>{['미상', '갑구', '을구'].map(v => <option key={v}>{v}</option>)}</select></label>
          <label>순위번호<input value={right.rank} onChange={e => update(right.id, { rank: e.target.value })} /></label>
          <label>등기 목적<input value={right.purpose} onChange={e => update(right.id, { purpose: e.target.value })} /></label>
          <label>권리 분류<select value={right.kind} onChange={e => update(right.id, { kind: e.target.value as RegistryRight['kind'] })}>{Object.entries(kinds).map(([key, label]) => <option value={key} key={key}>{label}</option>)}</select></label>
          <label>접수일자<input type="date" value={right.date} onChange={e => update(right.id, { date: e.target.value })} /></label>
          <label>접수번호<input value={right.receipt} onChange={e => update(right.id, { receipt: e.target.value })} /></label>
          <label>권리자<input value={right.holder} onChange={e => update(right.id, { holder: e.target.value })} /></label>
          <label>채권최고액 (원)<input type="number" min="0" step="1" value={right.amount} onChange={e => update(right.id, { amount: e.target.value })} /></label>
          <label>변경·이전·말소 대상 순위<input value={right.targetRank} onChange={e => update(right.id, { targetRank: e.target.value })} /></label>
          <label>근거 페이지<input type="number" min="1" step="1" value={right.page} onChange={e => update(right.id, { page: Number(e.target.value) })} /></label>
        </div>
        <label>대조한 근거 문구<textarea value={right.raw} onChange={e => update(right.id, { raw: e.target.value })} /></label>
        <label className="registry-check"><input type="checkbox" checked={right.excluded} onChange={e => update(right.id, { excluded: e.target.checked })} />이 권리를 합계/연결 처리에서 제외 (변경 이력은 원 권리를 먼저 수정)</label>
        <label className="registry-check"><input type="checkbox" checked={right.confirmed} onChange={e => update(right.id, { confirmed: e.target.checked })} />원문·금액·순위·변경 연결 및 제외 사유를 확인했습니다{right.kind === 'cancel' ? ' (부분말소가 아닌 전부말소임을 확인)' : ''}</label>
      </article>)}</div>
      <label htmlFor="planned-rank">신규 대출 예정 순위 (을구 주등기 순위)</label>
      <input id="planned-rank" type="number" min="1" step="1" value={plannedRank} onChange={e => { invalidate(); setPlannedRank(e.target.value); setCoverage(false) }} />
      <p>예정 순위보다 앞선 을구 근저당만 합산합니다. 부기등기·동순위·공동담보는 수동 정리가 필요합니다.</p>
      <label className="registry-check"><input type="checkbox" checked={coverage} onChange={e => { invalidate(); setCoverage(e.target.checked) }} />전체 페이지와 말소·변경 이력, 추출 누락·중복, 갑구 및 등기 외 위험을 확인했고 이 금액의 반영을 승인합니다.</label>
      {review.errors.length > 0 && <ul className="registry-warning">{review.errors.map(error => <li key={error}>{error}</li>)}</ul>}
      <p className="registry-total">검토 합계: {review.errors.length ? '확인 필요' : `${currency.format(review.total)}원`}</p>
      {review.cancelled.length > 0 && <p>연결된 전부말소 제외: {review.cancelled.length}개</p>}
      <button type="button" disabled={busy || !coverage || review.errors.length > 0 || review.total > 1000000000000} onClick={() => { onApply(review.total); setApplied(true) }}>승인한 채권최고액을 계산기에 반영</button>
      {applied && <p role="status">채권최고액 기준에 반영했습니다. 아래 계산기에서 수정·재계산할 수 있습니다. 검토 내용 변경 시 반영값은 초기화됩니다.</p>}
    </>}
  </section>
}
