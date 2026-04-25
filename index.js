import 'dotenv/config'
import express from 'express'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import { handleMessage } from './src/handlers/message.js'

// HTTP server untuk Back4App health check
const app = express()
const PORT = process.env.PORT || 3000

app.get('/', (req, res) => res.send('EWACS Bot running'))
app.get('/health', (req, res) => res.send('OK'))
app.listen(PORT, () => console.log(`HTTP server listening on port ${PORT}`))

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_session')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    browser: ['EWACS Bot', 'Chrome', '1.0.0']
  })

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.log('\n📱 Scan QR ini dengan WhatsApp:\n')
      qrcode.generate(qr, { small: true })
    }
    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode
      const shouldReconnect = reason !== DisconnectReason.loggedOut
      console.log(`⚠️  Koneksi terputus (${reason}). Reconnect: ${shouldReconnect}`)
      if (shouldReconnect) setTimeout(startBot, 3000)
    }
    if (connection === 'open') console.log('✅ EWACS Bot terhubung!')
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