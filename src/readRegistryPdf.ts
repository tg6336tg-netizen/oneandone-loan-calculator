import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { LocalOcr } from './localOcr'
import type { RegistryPage } from './registry'

GlobalWorkerOptions.workerSrc = pdfWorker
const assets = `${import.meta.env.BASE_URL}analysis-assets/`

export async function readRegistryPdf(file: File, progress: (message: string) => void, signal: AbortSignal): Promise<RegistryPage[]> {
  if (file.size > 25 * 1024 * 1024) throw new Error('PDF는 25MB 이하로 선택하세요.')
  const data = new Uint8Array(await file.arrayBuffer())
  if (!new TextDecoder().decode(data.slice(0, 1024)).includes('%PDF-')) throw new Error('유효한 PDF 파일이 아닙니다.')
  const loading = getDocument({ data, cMapUrl: `${assets}cmaps/`, cMapPacked: true, standardFontDataUrl: `${assets}standard_fonts/`, wasmUrl: `${assets}wasm/` })
  let worker: LocalOcr | undefined
  const cancel = () => {
    void loading.destroy().catch(() => {})
    if (worker) {
      const current = worker; worker = undefined
      current.terminate()
    }
  }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    if (signal.aborted) throw new Error('분석이 취소되었습니다.')
    const pdf = await loading.promise
    if (pdf.numPages > 30) throw new Error('한 번에 30페이지 이하의 PDF를 사용하세요.')
    const pages: RegistryPage[] = []
    for (let index = 1; index <= pdf.numPages; index++) {
      if (signal.aborted) throw new Error('분석이 취소되었습니다.')
      progress(`${index}/${pdf.numPages}페이지 텍스트 추출 중`)
      const page = await pdf.getPage(index)
      const content = await page.getTextContent()
      const lines = new Map<number, { x: number; text: string }[]>()
      for (const item of content.items) if ('str' in item) {
        const y = Math.round(item.transform[5] / 3) * 3
        const row = lines.get(y) ?? []
        row.push({ x: item.transform[4], text: item.str }); lines.set(y, row)
      }
      let text = [...lines.entries()].sort(([a], [b]) => b - a).map(([, row]) => row.sort((a, b) => a.x - b.x).map(x => x.text).join(' ')).join('\n')
      let source: RegistryPage['source'] = 'text'
      let confidence: number | undefined
      if (!text.replace(/\s/g, '').length) {
        progress(`${index}/${pdf.numPages}페이지 로컬 OCR 중 (처음 실행 시 시간이 걸립니다)`)
        if (!worker) { worker = new LocalOcr(assets, signal); await worker.initialize() }
        if (signal.aborted) throw new Error('분석이 취소되었습니다.')
        const initial = page.getViewport({ scale: 2 })
        const viewport = page.getViewport({ scale: 2 * Math.min(1, Math.sqrt(16000000 / (initial.width * initial.height))) })
        const canvas = document.createElement('canvas')
        canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height)
        try {
          await page.render({ canvas, viewport }).promise
          const result = await worker.recognize(canvas)
          text = result.text; confidence = result.confidence; source = 'ocr'
        } finally { canvas.width = 0; canvas.height = 0 }
      }
      pages.push({ page: index, text, source, confidence })
      page.cleanup()
    }
    return pages
  } finally {
    signal.removeEventListener('abort', cancel)
    if (worker) worker.terminate()
    await loading.destroy()
  }
}
