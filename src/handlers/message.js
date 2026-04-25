import { getSession, setSession, clearSession } from '../utils/session.js'
import { generateDailyCheck, generateMaintenanceCheck } from '../utils/template.js'
import { extractAssetFromImage } from '../services/ocr.js'
import { saveDailyCheck, saveMaintenanceCheck, getRekapShift, getRekapUnit, getShift, updateIP } from '../services/supabase.js'
import { downloadMediaMessage } from '@whiskeysockets/baileys'

export async function handleMessage(sock, msg) {
  const jid    = msg.key.remoteJid
  const sender = msg.key.participant || msg.key.remoteJid
  const body   = msg.message?.conversation ||
                 msg.message?.extendedTextMessage?.text ||
                 msg.message?.imageMessage?.caption || ''

  // Detect semua tipe image termasuk yang pakai viewOnce
  const isImage = !!(
    msg.message?.imageMessage ||
    msg.message?.viewOnceMessage?.message?.imageMessage ||
    msg.message?.viewOnceMessageV2?.message?.imageMessage
  )

  const session = getSession(sender)

  // ── HANDLER FOTO ──────────────────────────────────────────
  if (isImage && session) {
    try {
      await sock.sendMessage(jid, { text: '🔍 Membaca stiker asset...' }, { quoted: msg })

      const imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
        logger: { info: () => {}, error: console.error },
        reuploadRequest: sock.updateMediaMessage
      })

      const { mu, gsab } = await extractAssetFromImage(imageBuffer)

      if (session.type === 'dc') {
        await handleDcPhoto(sock, jid, sender, session, mu, gsab)
      } else if (session.type === 'mc') {
        await handleMcPhoto(sock, jid, sender, session, mu, gsab)
      }
    } catch (err) {
      console.error('Foto error:', err.message)
      await sock.sendMessage(jid, {
        text: '❌ Gagal baca foto. Ketik manual:\nMU[angka] GSAB[angka]\nContoh: MU3919 GSAB735024'
      }, { quoted: msg })
    }
    return
  }

  // ── HANDLER INPUT MANUAL ASSET ────────────────────────────
  // User ketik MUxxxx GSABxxxxxx saat session aktif
  if (session?.step === 'wait_photo') {
    const manualMatch = body.trim().toUpperCase().match(/^(MU[\d\?]+)\s+(GSAB[\d\?]+)$/)
    if (manualMatch) {
      const mu   = manualMatch[1].includes('?') ? null : manualMatch[1]
      const gsab = manualMatch[2].includes('?') ? null : manualMatch[2]

      if (session.type === 'dc') {
        await handleDcPhoto(sock, jid, sender, session, mu, gsab)
      } else if (session.type === 'mc') {
        await handleMcPhoto(sock, jid, sender, session, mu, gsab)
      }
      return
    }
  }

  const text = body.trim()
  if (!text) return

  // ── COMMAND !dc ───────────────────────────────────────────
  if (text.toLowerCase().startsWith('!dc ')) {
    const parts = text.slice(4).trim().split(/\s+/)
    const unitId = parts[0]
    const lokasi = parts.slice(1).join(' ')

    if (!unitId) {
      await sock.sendMessage(jid, { text: '❌ Format: !dc [No Unit] [Lokasi]\nContoh: !dc DT5010 Supernova' })
      return
    }

    setSession(sender, { type: 'dc', unitId, lokasi, step: 'wait_photo' })
    await sock.sendMessage(jid, {
      text: `✅ *${unitId.toUpperCase()}* - ${lokasi || '-'}\n\nKirim foto stiker asset, atau ketik manual:\n*MU[angka] GSAB[angka]*\nContoh: MU3919 GSAB735024`
    }, { quoted: msg })
    return
  }

  // ── COMMAND !mc ───────────────────────────────────────────
  if (text.toLowerCase().startsWith('!mc ')) {
    const parts = text.slice(4).trim().split(/\s+/)
    const unitId = parts[0]
    const lokasi = parts.slice(1).join(' ')

    if (!unitId) {
      await sock.sendMessage(jid, { text: '❌ Format: !mc [No Unit] [Lokasi]\nContoh: !mc DT5010 Supernova' })
      return
    }

    setSession(sender, { type: 'mc', unitId, lokasi, step: 'wait_detail' })
    await sock.sendMessage(jid, {
      text: `✅ *${unitId.toUpperCase()}* - ${lokasi}\n\nIsi detail + kirim foto stiker sekaligus:\n\nProblem:\nPenyebab:\nAction:\nStatus (open/closed):\nBacklog (-kalau tidak ada):`
    }, { quoted: msg })
    return
  }

  // ── HANDLER INPUT DETAIL MC ───────────────────────────────
  if (session?.type === 'mc' && session?.step === 'wait_detail') {
    const parsed = parseMcDetail(text)
    if (!parsed.problem) {
      await sock.sendMessage(jid, {
        text: '❌ Format tidak terbaca. Pastikan ada baris:\nProblem:\nPenyebab:\nAction:\nStatus:'
      })
      return
    }
    setSession(sender, { ...session, ...parsed, step: 'wait_photo' })
    await sock.sendMessage(jid, {
      text: '📸 Kirim foto stiker asset, atau ketik manual:\n*MU[angka] GSAB[angka]*'
    }, { quoted: msg })
    return
  }

  // ── COMMAND !rekap ────────────────────────────────────────
  if (text.toLowerCase() === '!rekap') {
    const today = new Date().toISOString().split('T')[0]
    const shift = getShift()
    const { sudah, belum } = await getRekapShift(today, shift)
    const belumText = belum.length > 0 ? belum.join(', ') : 'semua sudah ✅'
    await sock.sendMessage(jid, {
      text: `📋 *Rekap Shift ${shift} - ${new Date().toLocaleDateString('id-ID')}*\n\n` +
            `✅ Sudah : ${sudah.length} unit\n` +
            `❌ Belum : ${belum.length} unit\n\n` +
            `${belum.length > 0 ? '*Belum check:*\n' + belumText : '✅ Semua unit sudah daily check!'}`
    })
    return
  }

  // ── COMMAND !rekap [UNIT] ─────────────────────────────────
  if (text.toLowerCase().startsWith('!rekap ')) {
    const unitId = text.slice(7).trim().toUpperCase()
    const history = await getRekapUnit(unitId)
    if (!history || history.length === 0) {
      await sock.sendMessage(jid, { text: `❌ Tidak ada history untuk unit ${unitId}` })
      return
    }
    const lines = history.map(h =>
      `• ${new Date(h.waktu).toLocaleDateString('id-ID')} Shift ${h.shift} — ${h.status} (${h.lokasi})`
    ).join('\n')
    await sock.sendMessage(jid, { text: `📋 *History ${unitId}*\n\n${lines}` })
    return
  }

  // ── COMMAND !ip ───────────────────────────────────────────
  if (text.toLowerCase().startsWith('!ip ')) {
    const parts = text.slice(4).trim().split(/\s+/)
    const unitId = parts[0]
    const ip = parts[1]
    if (!unitId || !ip) {
      await sock.sendMessage(jid, { text: '❌ Format: !ip [No Unit] [IP]\nContoh: !ip DT5010 10.168.132.51' })
      return
    }
    const { error } = await updateIP(unitId, ip)
    if (error) {
      await sock.sendMessage(jid, { text: `❌ Gagal: ${error.message}` })
    } else {
      await sock.sendMessage(jid, { text: `✅ IP ${unitId.toUpperCase()} → ${ip} tersimpan` })
    }
    return
  }

  // ── COMMAND !help ─────────────────────────────────────────
  if (text.toLowerCase() === '!help') {
    await sock.sendMessage(jid, {
      text: `🤖 *EWACS Bot Commands*\n\n` +
            `!dc [Unit] [Lokasi] — Daily Check\n` +
            `!mc [Unit] [Lokasi] — Maintenance Check\n` +
            `!rekap — Rekap shift hari ini\n` +
            `!rekap [Unit] — History unit tertentu\n` +
            `!ip [Unit] [IP] — Update IP unit\n` +
            `!help — Menu ini`
    })
    return
  }
}

// ── HELPERS ───────────────────────────────────────────────────

async function handleDcPhoto(sock, jid, sender, session, mu, gsab) {
  const { unitId, lokasi } = session

  const template = generateDailyCheck({ unitId, lokasi, mu, gsab })

  await saveDailyCheck({
    unit_id    : unitId.toUpperCase(),
    tanggal    : new Date().toISOString().split('T')[0],
    shift      : getShift(),
    lokasi,
    asset_mu   : mu,
    asset_gsab : gsab,
    dicek_oleh : sender
  })

  clearSession(sender)

  const ocrInfo = mu
    ? `✅ OCR: ${mu} / ${gsab}`
    : `⚠️ OCR tidak terbaca — asset dikosongkan`

  await sock.sendMessage(jid, { text: `${ocrInfo}\n\n${template}` })
}

async function handleMcPhoto(sock, jid, sender, session, mu, gsab) {
  const { unitId, lokasi, problem, penyebab, action, status, backlog } = session

  const template = generateMaintenanceCheck({
    unitId, lokasi, mu, gsab,
    problem, penyebab, action, status, backlog
  })

  await saveMaintenanceCheck({
    unit_id    : unitId.toUpperCase(),
    tanggal    : new Date().toISOString().split('T')[0],
    shift      : getShift(),
    lokasi,
    asset_mu   : mu,
    asset_gsab : gsab,
    problem, penyebab, action, status, backlog,
    dicek_oleh : sender
  })

  clearSession(sender)

  const ocrInfo = mu
    ? `✅ OCR: ${mu} / ${gsab}`
    : `⚠️ OCR tidak terbaca — asset dikosongkan`

  await sock.sendMessage(jid, { text: `${ocrInfo}\n\n${template}` })
}

function parseMcDetail(text) {
  const result = {}
  for (const line of text.split('\n')) {
    const [key, ...rest] = line.split(':')
    const val = rest.join(':').trim()
    const k = key.toLowerCase().trim()
    if (k === 'problem')  result.problem  = val
    if (k === 'penyebab') result.penyebab = val
    if (k === 'action')   result.action   = val
    if (k === 'status')   result.status   = val
    if (k === 'backlog')  result.backlog  = val || '-'
  }
  return result
}
