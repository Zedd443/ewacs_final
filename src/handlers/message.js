import { getRekapBulanan, namaBulan } from '../services/rekap.js'
import { getSession, setSession, clearSession } from '../utils/session.js'
import { getRekapBulanan, namaBulan } from '../services/rekap.js'
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

  const isImage = !!(
    msg.message?.imageMessage ||
    msg.message?.viewOnceMessage?.message?.imageMessage ||
    msg.message?.viewOnceMessageV2?.message?.imageMessage
  )

  const session = getSession(sender)

  // ── HANDLER FOTO ──────────────────────────────────────────
  if (isImage && session?.step === 'wait_photo') {
    try {
      await sock.sendMessage(jid, { text: '🔍 Membaca stiker asset...' }, { quoted: msg })

      const imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
        logger: { info: () => {}, error: console.error },
        reuploadRequest: sock.updateMediaMessage
      })

      const { mu, gsab } = await extractAssetFromImage(imageBuffer)

      if (session.type === 'dc') {
        await handleDcPhoto(sock, jid, sender, session, mu, gsab, msg)
      } else if (session.type === 'mc') {
        await handleMcPhoto(sock, jid, sender, session, mu, gsab, msg)
      }
    } catch (err) {
      console.error('Foto error:', err.message)
      await sock.sendMessage(jid, {
        text: '❌ Gagal baca foto. Ketik manual:\n*MU[angka] GSAB[angka]*\nGunakan ? untuk digit yang tidak terbaca\nContoh: MU3?19 GSAB5267??'
      }, { quoted: msg })
    }
    return
  }

  // ── HANDLER INPUT MANUAL ASSET ────────────────────────────
  if (session?.step === 'wait_photo') {
    const manualMatch = body.trim().toUpperCase().match(/^(MU[\d\?]+)\s+(GSAB[\d\?]+)$/)
    if (manualMatch) {
      const mu   = manualMatch[1]
      const gsab = manualMatch[2]
      if (session.type === 'dc') {
        await handleDcPhoto(sock, jid, sender, session, mu, gsab, null)
      } else if (session.type === 'mc') {
        await handleMcPhoto(sock, jid, sender, session, mu, gsab, null)
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
      text: `✅ *${unitId.toUpperCase()}* - ${lokasi || '-'}\n\nKirim foto stiker asset (collage ok), atau ketik manual:\n*MU[angka] GSAB[angka]*\nGunakan ? untuk digit ragu: MU3?19 GSAB5267??`
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
      text: `✅ *${unitId.toUpperCase()}* - ${lokasi}\n\nIsi detail:\n\nProblem:\nPenyebab:\nAction:\nStatus (open/closed):\nBacklog (-kalau tidak ada):\n\nKirim sekaligus dengan foto stiker`
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
    await sock.sendMessage(jid, {
      text: `📋 *Rekap Shift ${shift} - ${new Date().toLocaleDateString('id-ID')}*\n\n` +
            `✅ Sudah : ${sudah.length} unit\n` +
            `❌ Belum : ${belum.length} unit\n\n` +
            `${belum.length > 0 ? '*Belum check:*\n' + belum.join(', ') : '✅ Semua unit sudah daily check!'}`
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

  // ── COMMAND !rekap bulan ──────────────────────────────────
  if (text.toLowerCase().startsWith('!rekap bulan')) {
    const parts = text.split(' ')
    const now = new Date()
    const wib = new Date(now.getTime() + 8 * 60 * 60 * 1000)
    const bulan = parseInt(parts[2]) || (wib.getMonth() + 1)
    const tahun = parseInt(parts[3]) || wib.getFullYear()
    const { units, perUnit } = await getRekapBulanan(bulan, tahun)

    const totalChecks = Object.values(perUnit).flat().length
    let out = `📊 *Rekap ${namaBulan(bulan)} ${tahun}*\n`
    out += `Total: ${units.length} unit | ${totalChecks} check\n\n`
    out += `Unit     MU       GSAB          Chk  IP\n`
    out += `${'─'.repeat(48)}\n`

    for (const u of units) {
      const checks = perUnit[u.unit_id] || []
      const mu   = (u.asset_mu   || 'MUxxxx').padEnd(8)
      const gsab = (u.asset_gsab || 'GSABxxxxx').padEnd(13)
      const ip   = u.ip || '-'
      const chk  = String(checks.length).padEnd(4)
      out += `${u.unit_id.padEnd(8)} ${mu} ${gsab} ${chk} ${ip}\n`
    }

    await sock.sendMessage(jid, { text: '```\n' + out + '```' })
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
            `!rekap bulan [bln] [thn] — Rekap bulanan\n` +
            `!ip [Unit] [IP] — Update IP unit\n` +
            `!help — Menu ini`
    })
    return
  }
}

// ── HELPERS ───────────────────────────────────────────────────

async function handleDcPhoto(sock, jid, sender, session, mu, gsab, originalMsg) {
  const { unitId, lokasi } = session

  // Tampilkan MU???? kalau tidak terbaca, atau nilai aslinya kalau ada ? dari user
  const muDisplay   = mu   || 'MUxxxx'
  const gsabDisplay = gsab || 'GSABxxxxx'

  const template = generateDailyCheck({ unitId, lokasi, mu: muDisplay, gsab: gsabDisplay })

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


  // Kirim collage balik dulu kalau ada foto
  if (originalMsg?.message?.imageMessage) {
    await sock.sendMessage(jid, {
      forward: originalMsg
    })
  }

  await sock.sendMessage(jid, { text: `${template}` })
}

async function handleMcPhoto(sock, jid, sender, session, mu, gsab, originalMsg) {
  const { unitId, lokasi, problem, penyebab, action, status, backlog } = session

  const muDisplay   = mu   || 'MUxxxx'
  const gsabDisplay = gsab || 'GSABxxxxx'

  const template = generateMaintenanceCheck({
    unitId, lokasi,
    mu: muDisplay, gsab: gsabDisplay,
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


  if (originalMsg?.message?.imageMessage) {
    await sock.sendMessage(jid, {
      forward: originalMsg
    })
  }

  await sock.sendMessage(jid, { text: `${template}` })
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

// ── REKAP BULANAN (tambahan di bawah exports) ─────────────────
// Import di atas sudah ada, ini handler tambahan
// Dipanggil dari handleMessage via !rekap bulan
