import 'dotenv/config'
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion
} from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import qrcode from 'qrcode-terminal'
import pino from 'pino'
import { useSupabaseAuthState } from './src/services/authState.js'
import { handleMessage } from './src/handlers/message.js'

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
    if (connection === 'open') {
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
