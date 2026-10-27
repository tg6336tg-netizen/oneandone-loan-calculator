export type RegistryPage = { page: number; text: string; source: 'text' | 'ocr' | 'manual'; confidence?: number }
export type RegistryRight = {
  id: string; section: '갑구' | '을구' | '미상'; rank: string; purpose: string
  date: string; receipt: string; holder: string; amount: string; targetRank: string
  kind: 'mortgage' | 'change' | 'transfer' | 'cancel' | 'risk' | 'unknown'
  page: number; raw: string; confidence: string; warnings: string[]
  confirmed: boolean; excluded: boolean
}

// Reject uncertain units/OCR characters rather than guessing a monetary value.
export function parseWon(value: string): number | null {
  const clean = value.replace(/[금\s,]/g, '')
  if (!/^\d+(?:억\d+만|억|만|천만|백만|십만)?원?$/.test(clean)) return null
  let total: number
  const combined = clean.match(/^(\d+)억(\d+)만원?$/)
  if (combined) total = Number(combined[1]) * 100000000 + Number(combined[2]) * 10000
  else {
    const match = clean.match(/^(\d+)(억|천만|백만|십만|만)?원?$/)!
    total = Number(match[1]) * ({ 억: 100000000, 천만: 10000000, 백만: 1000000, 십만: 100000, 만: 10000 }[match[2]] ?? 1)
  }
  return Number.isSafeInteger(total) && total >= 0 ? total : null
}

export function parseRegistry(pages: RegistryPage[]): RegistryRight[] {
  const rights: RegistryRight[] = []
  let section: RegistryRight['section'] = '미상'
  let current: { section: RegistryRight['section']; rank: string; page: RegistryPage; lines: string[] } | null = null
  function flush() {
    if (!current) return
    const raw = current.lines.join('\n')
    const compact = raw.replace(/\s/g, '')
    const kind = /일부말소|부분말소|변경|감액|증액/.test(compact) ? 'change'
      : /말소/.test(compact) ? 'cancel' : /근저당권.*이전/.test(compact) ? 'transfer'
      : /압류|가압류|가처분|경매개시/.test(compact) ? 'risk'
      : /근저당권설정/.test(compact) ? 'mortgage' : 'unknown'
    const amounts = [...compact.matchAll(/채권최고액(?:금)?([0-9,억만천백십]+원)/g)]
    const amount = amounts.length === 1 ? parseWon(amounts[0][1]) : null
    const targets = [...new Set([...compact.matchAll(/(?:제)?(\d+(?:-\d+)?)번/g)].map(match => match[1]))]
    const target = targets.length === 1 ? targets[0] : ''
    const date = compact.match(/(\d{4})년(\d{1,2})월(\d{1,2})일/)
    const warnings: string[] = []
    if (current.page.source === 'ocr') warnings.push('OCR 오인식 가능: 원문 대조 필수')
    if (current.section === '미상') warnings.push('갑구/을구 구분 필요')
    if (/공동담보|공동담보목록/.test(compact)) warnings.push('공동담보목록 및 중복 채권 확인 필요')
    if (/일부|부분/.test(compact)) warnings.push('일부말소/부분 변경: 자동 말소 제외 불가, 수동 정리 필요')
    if (['change', 'transfer', 'cancel'].includes(kind)) warnings.push('대상 순위와 변경·이전·전부말소 연결 확인 필요')
    if (amount === null && ['mortgage', 'change'].includes(kind)) warnings.push('채권최고액을 정확히 판독하지 못함')
    if (amounts.length > 1) warnings.push('복수 금액: 적용 금액 수동 확인 필요')
    if (targets.length > 1) warnings.push('복수 연결 대상: 각 권리별로 수동 분리·대조 필요')
    const holder = raw.match(/(?:근저당권자|권리자|채권자)\s*([^\n]+)/)?.[1]?.trim() ?? ''
    rights.push({ id: `right-${rights.length + 1}`, section: current.section, rank: current.rank,
      purpose: raw.split('\n').slice(0, 2).join(' ').slice(0, 160), kind,
      date: date ? `${date[1]}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}` : '',
      receipt: compact.match(/제(\d+)호/)?.[1] ?? '', holder, amount: amount === null ? '' : String(amount),
      targetRank: target, page: current.page.page, raw, confidence: current.page.source === 'ocr'
        ? `OCR ${Math.round(current.page.confidence ?? 0)}% (법적 정확도 아님)` : '규칙 기반 추출 · 미확인',
      warnings, confirmed: false, excluded: false })
    current = null
  }
  for (const page of pages) {
    for (const line of page.text.split('\n').map(s => s.trim()).filter(Boolean)) {
      if (/갑\s*구|을\s*구/.test(line) && /갑\s*구|을\s*구/.test(line.slice(0, 15))) {
        flush(); section = /갑\s*구/.test(line) ? '갑구' : '을구'; continue
      }
      if (/^(순위번호|등기목적|접수|주요 등기사항|열람일시|발급일시)/.test(line)) continue
      const start = line.match(/^(\d+(?:-\d+)?)\s+(.*)$/) ?? line.match(/^(\d+(?:-\d+)?)$/)
      if (start) { flush(); current = { section, rank: start[1], page, lines: [start[2] ?? ''] } }
      else if (current) current.lines.push(line)
      else if (/근저당|압류|가처분|경매|채권최고액/.test(line)) {
        current = { section, rank: '', page, lines: [line] }
      }
    }
    // A continuation on the next page cannot safely be assigned to a row automatically.
    flush()
  }
  return rights
}

export function reviewTotal(rights: RegistryRight[], plannedRank: string) {
  const errors: string[] = []
  if (!/^\d+$/.test(plannedRank) || Number(plannedRank) < 1 || !Number.isSafeInteger(Number(plannedRank))) errors.push('신규 대출 예정 순위를 정수로 입력하세요.')
  if (!rights.length) errors.push('검토할 권리가 없습니다. 수동 입력하거나 PDF를 확인하세요.')
  if (rights.some(r => !r.confirmed)) errors.push('모든 권리를 원문과 대조해 확인하거나 제외 승인하세요.')
  const active = rights.filter(r => r.confirmed && !r.excluded)
  if (active.some(r => r.kind === 'mortgage' && r.section !== '을구')) errors.push('근저당 권리의 갑구/을구 분류를 다시 확인하세요.')
  for (const right of rights.filter(r => r.confirmed)) {
    if (!right.raw.trim() || !Number.isInteger(right.page) || right.page < 1) errors.push(`${right.id}: 근거 문구와 페이지를 확인하세요.`)
  }
  const mortgages = active.filter(r => r.kind === 'mortgage' && r.section === '을구')
  const amounts = new Map<string, number>()
  for (const right of mortgages) {
    if (!/^\d+$/.test(right.rank)) errors.push(`${right.id}: 부기 순위 또는 미상 순위를 수동 정리하세요.`)
    if (mortgages.filter(r => r.rank === right.rank).length > 1) errors.push(`${right.rank}번: 중복 순위/공동담보 여부를 정리하세요.`)
    const amount = /^\d+$/.test(right.amount) ? Number(right.amount) : NaN
    if (!Number.isSafeInteger(amount) || amount < 0) errors.push(`${right.rank}번: 채권최고액을 원 단위 정수로 확인하세요.`)
    amounts.set(right.id, amount)
  }
  const events = active.filter(r => ['change', 'transfer', 'cancel'].includes(r.kind))
  const cancelled = new Set<string>()
  for (const event of events) {
    const targets = mortgages.filter(r => r.rank === event.targetRank && r.section === event.section)
    if (targets.length !== 1) { errors.push(`${event.id}: 변경/말소 대상 순위를 연결하세요.`); continue }
    const target = targets[0]
    if (event.kind === 'cancel') {
      if (/일부|부분/.test(event.raw)) errors.push(`${event.id}: 일부말소는 전부말소로 처리할 수 없습니다.`)
      else cancelled.add(target.id)
    } else if (event.kind === 'change') {
      // Do not guess amendment chronology or reduce debt from a partial cancellation.
      errors.push(`${event.id}: 변경/감액/증액은 원문 확인 후 원 권리 금액을 수정하고 이 이력을 제외 승인하세요.`)
    }
  }
  if (active.some(r => r.kind === 'unknown' || r.section === '미상')) errors.push('분류되지 않은 권리를 수정하거나 제외 승인하세요.')
  let total = 0
  for (const right of mortgages) if (!cancelled.has(right.id) && Number(right.rank) < Number(plannedRank)) total += amounts.get(right.id) ?? 0
  if (!Number.isSafeInteger(total)) errors.push('합계가 유효한 원 단위 범위를 벗어났습니다.')
  return { total, errors: [...new Set(errors)], cancelled: [...cancelled] }
}
