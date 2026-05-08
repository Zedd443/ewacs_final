import { createWorker } from 'tesseract.js'
import Jimp from 'jimp'

export async function extractAssetFromImage(imageBuffer) {
  let worker = null
  try {
    const image = await Jimp.read(imageBuffer)
    image.grayscale().contrast(0.5)
    const processedBuffer = await image.getBufferAsync(Jimp.MIME_PNG)

    worker = await createWorker('eng')
    const { data: { text } } = await worker.recognize(processedBuffer)
    await worker.terminate()

    return parseAssetText(text)
  } catch (err) {
    console.error('OCR error:', err.message)
    if (worker) try { await worker.terminate() } catch (_) {}
    return { mu: null, gsab: null }
  }
}

function parseAssetText(text) {
  const clean = text.replace(/\s+/g, ' ').toUpperCase()
  const muMatch   = clean.match(/MU[\s\-]?(\d{3,6})/)
  const gsabMatch = clean.match(/GSAB[\s\-]?(\d{4,8})/)
  const mu   = muMatch   ? `MU${muMatch[1]}`   : null
  const gsab = gsabMatch ? `GSAB${gsabMatch[1]}` : null
  return { mu, gsab }
}
