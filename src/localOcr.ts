// Own the Tesseract.js worker transport so cancellation and initialization failures
// can always terminate the worker (including before language loading completes).
// The bundled worker protocol is pinned by package-lock.json and exercised by E2E.
export class LocalOcr {
  private worker: Worker
  private pending: { jobId: string; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | null = null
  private stopped = false
  private assets: string
  private signal: AbortSignal
  constructor(assets: string, signal: AbortSignal) {
    this.assets = assets; this.signal = signal
    this.worker = new Worker(`${assets}ocr-worker.js`)
    this.worker.onmessage = event => {
      if (!this.pending || event.data.jobId !== this.pending.jobId || event.data.status === 'progress') return
      const pending = this.pending; this.pending = null; clearTimeout(pending.timer)
      if (event.data.status === 'resolve') pending.resolve(event.data.data)
      else { pending.reject(new Error('로컬 OCR 처리 실패')); this.terminate() }
    }
    this.worker.onerror = event => { event.preventDefault(); this.terminate() }
    signal.addEventListener('abort', this.terminate, { once: true })
  }
  terminate = () => {
    this.stopped = true; this.worker.terminate()
    this.signal.removeEventListener('abort', this.terminate)
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(new Error('OCR 취소 또는 실패')); this.pending = null }
  }
  private job(action: string, payload: unknown): Promise<unknown> {
    if (this.stopped || this.signal.aborted) return Promise.reject(new Error('분석 취소'))
    return new Promise((resolve, reject) => {
      const jobId = crypto.randomUUID()
      this.pending = { jobId, resolve, reject, timer: setTimeout(this.terminate, 120000) }
      this.worker.postMessage({ workerId: 'local-ocr', jobId, action, payload })
    })
  }
  async initialize() {
    await this.job('load', { options: { lstmOnly: true, corePath: `${this.assets}core`, logging: false } })
    await this.job('loadLanguage', { langs: 'kor+eng', options: { langPath: `${this.assets}lang`, cacheMethod: 'none', gzip: true, lstmOnly: true } })
    await this.job('initialize', { langs: 'kor+eng', oem: 1, config: {} })
  }
  async recognize(canvas: HTMLCanvasElement) {
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('페이지 이미지 변환 실패')), 'image/png'))
    return await this.job('recognize', { image: new Uint8Array(await blob.arrayBuffer()), options: {}, output: { text: true } }) as { text: string; confidence: number }
  }
}
