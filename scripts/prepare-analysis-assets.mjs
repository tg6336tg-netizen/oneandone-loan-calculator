import { cp, mkdir, readdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(import.meta.url)
const root = path.resolve('public/analysis-assets')
await mkdir(root, { recursive: true })
const packageRoot = name => path.dirname(require.resolve(`${name}/package.json`))
await cp(path.join(packageRoot('tesseract.js'), 'dist/worker.min.js'), path.join(root, 'ocr-worker.js'))
const core = packageRoot('tesseract.js-core')
await mkdir(path.join(root, 'core'), { recursive: true })
for (const file of await readdir(core)) if (/\.wasm(?:\.js)?$/.test(file)) await cp(path.join(core, file), path.join(root, 'core', file))
await mkdir(path.join(root, 'lang'), { recursive: true })
for (const language of ['kor', 'eng']) await cp(path.join(packageRoot(`@tesseract.js-data/${language}`), '4.0.0', `${language}.traineddata.gz`), path.join(root, 'lang', `${language}.traineddata.gz`))
for (const directory of ['cmaps', 'standard_fonts', 'wasm']) await cp(path.join(packageRoot('pdfjs-dist'), directory), path.join(root, directory), { recursive: true })
console.log('Local PDF/OCR workers, WASM, fonts and language assets prepared.')
