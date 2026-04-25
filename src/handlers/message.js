import { getSession, setSession, clearSession } from '../utils/session.js/index.js'
import { generateDailyCheck, generateMaintenanceCheck } from '../utils/template.js'
import { extractAssetFromImage } from '../services/ocr.js/index.js'
import { saveDailyCheck, saveMaintenanceCheck, getRekapShift, getRekapUnit, getShift, updateIP } from '../services/supabase.js/index.js'

export async function handleMessage(sock, msg) {
  const jid    = msg.key.remoteJid
  const sender = msg.key.participant || msg.key.remoteJid
  const body   = msg.message?.conversation ||
                 msg.message?.extendedTextMessage?.text || ''
  const isImage = !!(msg.message?.imageMessage)

  const session = getSession(sender)

  // ── HANDLER FOTO ──────────────────────────────────────────
  if (isImage && session) {
    const imageBuffer = await sock.downloadMediaMessage(msg, 'buffer')
    const { mu, gsab } = await extractAssetFromImage(imageBuffer)

    if (session.type === 'dc') {
      await handleDcPhoto(sock, jid, sender, session, mu, gsab)
    } else if (session.type === 'mc') {
      await handleMcPhoto(sock, jid, sender, session, mu, gsab)
    }
    return
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
      text: `✅ *${unitId.toUpperCase()}* - ${lokasi || 'lokasi belum diisi'}\nKirim foto stiker asset (MU + GSAB):`
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
      text: `✅ *${unitId.toUpperCase()}* - ${lokasi}\n\nIsi detail + kirim foto stiker sekaligus:\n\n` +
            `Problem:\nPenyebab:\nAction:\nStatus (open/closed):\nBacklog (-kalau tidak ada):`
    }, { quoted: msg })
    return
  }

  // ── HANDLER INPUT DETAIL MC ───────────────────────────────
  if (session?.type === 'mc' && session?.step === 'wait_detail') {
    const parsed = parseMcDetail(text)
    if (!parsed.problem) {
      await sock.sendMessage(jid, { text: '❌ Format tidak terbaca. Pastikan ada baris "Problem:", "Penyebab:", "Action:", "Status:"' })
      return
    }
    setSession(sender, { ...session, ...parsed, step: 'wait_photo' })
    await sock.sendMessage(jid, { text: '📸 Sekarang kirim foto stiker asset (MU + GSAB):' }, { quoted: msg })
    return
  }

  // ── COMMAND !rekap ────────────────────────────────────────
  if (text.toLowerCase() === '!rekap') {
    const today = new Date().toISOString().split('T')[0]
    const shift = getShift()
    const { sudah, belum } = await getRekapShift(today, shift)

    const belumText = belum.length > 0
      ? belum.join(', ')
      : 'semua sudah ✅'

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

  // ── COMMAND !ip (update IP unit) ─────────────────────────
  // Format: !ip DT5010 10.168.132.51
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
      await sock.sendMessage(jid, { text: `❌ Gagal update IP: ${error.message}` })
    } else {
      await sock.sendMessage(jid, { text: `✅ IP ${unitId.toUpperCase()} → ${ip} berhasil disimpan` })
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
            `!help — Tampilkan menu ini`
    })
    return
  }
}

// ── HELPERS ───────────────────────────────────────────────────

async function handleDcPhoto(sock, jid, sender, session, mu, gsab) {
  const { unitId, lokasi } = session

  const template = generateDailyCheck({
    unitId, lokasi,
    mu: mu || 'MU?',
    gsab: gsab || 'GSAB?'
  })

  await saveDailyCheck({
    unit_id: unitId.toUpperCase(),
    tanggal: new Date().toISOString().split('T')[0],
    shift: getShift(),
    lokasi,
    asset_mu: mu,
    asset_gsab: gsab,
    dicek_oleh: sender
  })

  clearSession(sender)

  const ocrInfo = mu
    ? `✅ OCR berhasil: ${mu} / ${gsab}`
    : `⚠️ OCR tidak terbaca, asset dikosongkan`

  await sock.sendMessage(jid, { text: `${ocrInfo}\n\n${template}` })
}

async function handleMcPhoto(sock, jid, sender, session, mu, gsab) {
  const { unitId, lokasi, problem, penyebab, action, status, backlog } = session

  const template = generateMaintenanceCheck({
    unitId, lokasi,
    mu: mu || 'MU?',
    gsab: gsab || 'GSAB?',
    problem, penyebab, action, status, backlog
  })

  await saveMaintenanceCheck({
    unit_id: unitId.toUpperCase(),
    tanggal: new Date().toISOString().split('T')[0],
    shift: getShift(),
    lokasi,
    asset_mu: mu,
    asset_gsab: gsab,
    problem, penyebab, action, status, backlog,
    dicek_oleh: sender
  })

  clearSession(sender)

  const ocrInfo = mu
    ? `✅ OCR berhasil: ${mu} / ${gsab}`
    : `⚠️ OCR tidak terbaca, asset dikosongkan`

  await sock.sendMessage(jid, { text: `${ocrInfo}\n\n${template}` })
}

// Parse input multi-baris untuk MC
function parseMcDetail(text) {
  const result = {}
  const lines = text.split('\n')

  for (const line of lines) {
    const [key, ...rest] = line.split(':')
    const val = rest.join(':').trim()
    const k = key.toLowerCase().trim()

    if (k === 'problem')   result.problem  = val
    if (k === 'penyebab')  result.penyebab = val
    if (k === 'action')    result.action   = val
    if (k === 'status')    result.status   = val
    if (k === 'backlog')   result.backlog  = val || '-'
  }

  return result
}