const axios = require('axios')

const VISION_KEY = process.env.GOOGLE_VISION_KEY

// Kirim image base64 ke Google Vision, extract teks
async function extractTextFromImage(base64Image) {
  if (!VISION_KEY) throw new Error('Google Vision key tidak ada di .env')

  const res = await axios.post(
    `https://vision.googleapis.com/v1/images:annotate?key=${VISION_KEY}`,
    {
      requests: [{
        image: { content: base64Image },
        features: [{ type: 'TEXT_DETECTION' }]
      }]
    }
  )

  const text = res.data.responses?.[0]?.fullTextAnnotation?.text || ''
  return text
}

// Cari pattern MU dan GSAB dari teks OCR hasil Vision
function parseAssetFromText(text) {
  const muMatch = text.match(/MU\s*(\d+)/i)
  const gsabMatch = text.match(/GSAB\s*(\d+)/i)

  return {
    mu: muMatch ? `MU${muMatch[1]}` : null,
    gsab: gsabMatch ? `GSAB${gsabMatch[1]}` : null
  }
}

module.exports = { extractTextFromImage, parseAssetFromText }