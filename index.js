import 'dotenv/config'
import express from 'express'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import QRCode from 'qrcode'
import pino from 'pino'
import { handleMessage } from './src/handlers/message.js'
import { useSupabaseAuthState } from './src/services/authState.js'

const app = express()
const PORT = process.env.PORT || 3000

let currentQR = null

app.get('/', (req, res) => {
  if (currentQR) {
    res.send(`
      <html>
        <head><title>EWACS Bot QR</title></head>
        <body style="text-align:center;padding:40px;background:#111;color:#fff">
          <h2>📱 Scan QR dengan WhatsApp</h2>
          <img src="${currentQR}" style="width:300px;height:300px"/>
          <p>Refresh halaman ini kalau QR expired</p>
        </body>
      </html>
    `)
  } else {
    res.send('<html><body style="background:#111;color:#0f0;text-align:center;padding:40px"><h2>✅ EWACS Bot Connected!</h2></body></html>')
  }
})
app.get('/health', (req, res) => res.send('OK'))
app.listen(PORT, () => {
  console.log(`HTTP server listening on port ${PORT}`)

  const appUrl = process.env.APP_URL
  if (appUrl) {
    setInterval(async () => {
      try {
        const res = await fetch(`${appUrl}/health`)
        console.log(`[self-ping] ${res.status}`)
      } catch (err) {
        console.error(`[self-ping] failed: ${err.message}`)
      }
    }, 4 * 60 * 1000)
    console.log(`[self-ping] aktif → ${appUrl}/health setiap 4 menit`)
  } else {
    console.warn('[self-ping] APP_URL tidak di-set, self-ping nonaktif')
  }
})

async function startBot() {
  const { state, saveCreds } = await useSupabaseAuthState()
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['EWACS Bot', 'Chrome', '1.0.0']
  })

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      currentQR = await QRCode.toDataURL(qr)
      console.log('📱 QR siap, buka URL app untuk scan')
    }
    if (connection === 'close') {
      currentQR = null
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode
      const shouldReconnect = reason !== DisconnectReason.loggedOut
      console.log(`⚠️  Koneksi terputus (${reason}). Reconnect: ${shouldReconnect}`)
      if (shouldReconnect) setTimeout(startBot, 3000)
    }
    if (connection === 'open') {
      currentQR = null
      console.log('✅ EWACS Bot terhubung!')
    }
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return
    for (const msg of messages) {
      if (msg.key.fromMe) continue
      try { await handleMessage(sock, msg) }
      catch (err) { console.error('Handler error:', err.message) }
    }
  })
}

startBot()
