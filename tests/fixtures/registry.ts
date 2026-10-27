// Synthetic examples only; never use real borrower documents in test fixtures.
export const mortgageText = `갑구
1 소유권이전
2025년1월1일 제1호
권리자 예시소유자
을구
3 근저당권설정
2025년3월1일 제300호
채권최고액 금90,000,000원
근저당권자 예시후순위은행
1 근저당권설정
2024년1월2일 제100호
채권최고액 금120,000,001원
근저당권자 예시선순위은행`

export const cancellation = `을구
4 1번근저당권설정등기말소
2026년1월1일 제400호`

export const amendment = (purpose: string, amount = '80,000,000') => `을구
1-1 1번근저당권${purpose}
2025년7월1일 제250호
채권최고액 금${amount}원`
