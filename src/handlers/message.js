import { getRekapBulanan, namaBulan } from '../services/rekap.js'
import { getSession, setSession, clearSession } from '../utils/session.js'
import { generateDailyCheck, generateMaintenanceCheck } from '../utils/template.js'
import { extractAssetFromImage } from '../services/ocr.js'
import { saveDailyCheck, saveMaintenanceCheck, getRekapShift, getRekapUnit, getShift, updateIP } from '../services/supabase.js'
import { downloadMediaMessage } from '@whiskeysockets/baileys'

const BULAN_MAP = {
  januari:1, februari:2, maret:3, april:4, mei:5, juni:6,
  juli:7, agustus:8, september:9, oktober:10, november:11, desember:12
}

const MC_STEPS = ['problem', 'penyebab', 'action', 'status', 'backlog']

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
  const text = body.trim()

  // ── CANCEL ────────────────────────────────────────────────
  if (text.toLowerCase() === '!batal') {
    if (session) {
      clearSession(sender)
      await sock.sendMessage(jid, { text: '❌ Dibatalkan.' }, { quoted: msg })
    } else {
      await sock.sendMessage(jid, { text: 'Tidak ada proses aktif.' }, { quoted: msg })
    }
    return
  }

  // ── HANDLER FOTO (dc/mc wait_photo) ───────────────────────
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
    const manualMatch = text.toUpperCase().match(/^(MU[\d\?]+)\s+(GSAB[\d\?]+)$/)
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

  // ── HANDLER INPUT DETAIL MC ───────────────────────────────
  if (session?.type === 'mc' && session?.step === 'wait_detail') {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length < 4) {
      await sock.sendMessage(jid, {
        text: '❌ Kurang lengkap. Isi 5 baris sesuai urutan:\n\n[Problem]\n[Penyebab]\n[Action]\n[Status]\n[Backlog]\n\nBisa sekalian kirim foto stiker sebagai caption.\nKetik *!batal* untuk membatalkan.'
      }, { quoted: msg })
      return
    }
    const [problem, penyebab, action, status, backlog = '-'] = lines
    const updatedSession = { ...session, problem, penyebab, action, status, backlog, step: 'wait_photo' }

    if (isImage) {
      try {
        await sock.sendMessage(jid, { text: '🔍 Membaca stiker asset...' }, { quoted: msg })
        const imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
          logger: { info: () => {}, error: console.error },
          reuploadRequest: sock.updateMediaMessage
        })
        const { mu, gsab } = await extractAssetFromImage(imageBuffer)
        await handleMcPhoto(sock, jid, sender, updatedSession, mu, gsab, msg)
      } catch (err) {
        console.error('Foto error:', err.message)
        setSession(sender, updatedSession)
        await sock.sendMessage(jid, {
          text: '❌ Gagal baca foto. Kirim ulang foto atau ketik manual:\n*MU[angka] GSAB[angka]*'
        }, { quoted: msg })
      }
    } else {
      setSession(sender, updatedSession)
      await sock.sendMessage(jid, {
        text: '📸 Kirim foto stiker asset, atau ketik manual:\n*MU[angka] GSAB[angka]*\n\nKetik *!batal* untuk membatalkan.'
      }, { quoted: msg })
    }
    return
  }

  if (!text) return

  // ── COMMAND !dc ───────────────────────────────────────────
  if (text.toLowerCase().startsWith('!dc ')) {
    const parts = text.slice(4).trim().split(/\s+/)
    const unitId = parts[0]
    const lokasi = parts.slice(1).join(' ')

    if (!unitId) {
      await sock.sendMessage(jid, {
        text: '❌ Format: !dc [No Unit] [Lokasi]\nContoh: !dc DT5010 Supernova\n\nBisa sekalian kirim foto stiker sebagai caption.\nKetik *!batal* untuk membatalkan.'
      })
      return
    }

    const dcSession = { type: 'dc', unitId, lokasi, step: 'wait_photo' }

    if (isImage) {
      try {
        await sock.sendMessage(jid, { text: '🔍 Membaca stiker asset...' }, { quoted: msg })
        const imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
          logger: { info: () => {}, error: console.error },
          reuploadRequest: sock.updateMediaMessage
        })
        const { mu, gsab } = await extractAssetFromImage(imageBuffer)
        await handleDcPhoto(sock, jid, sender, dcSession, mu, gsab, msg)
      } catch (err) {
        console.error('Foto error:', err.message)
        setSession(sender, dcSession)
        await sock.sendMessage(jid, {
          text: '❌ Gagal baca foto. Kirim ulang foto atau ketik manual:\n*MU[angka] GSAB[angka]*'
        }, { quoted: msg })
      }
    } else {
      setSession(sender, dcSession)
      await sock.sendMessage(jid, {
        text: `✅ *${unitId.toUpperCase()}* - ${lokasi || '-'}\n\nKirim foto stiker asset (collage ok), atau ketik manual:\n*MU[angka] GSAB[angka]*\nGunakan ? untuk digit ragu: MU3?19 GSAB5267??\n\nKetik *!batal* untuk membatalkan.`
      }, { quoted: msg })
    }
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
      text: `✅ *${unitId.toUpperCase()}* - ${lokasi || '-'}\n\nIsi detail (5 baris sesuai urutan):\n\n[Problem]\n[Penyebab]\n[Action]\n[Status (open/closed)]\n[Backlog (-kalau tidak ada)]\n\nBisa sekalian kirim foto stiker sebagai caption.\nKetik *!batal* untuk membatalkan.`
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

  // ── COMMAND !rekap [bulan] [tahun] ────────────────────────
  // Format: !rekap april 2026  |  !rekap april 2026 DT5010
  if (text.toLowerCase().startsWith('!rekap ')) {
    const parts = text.slice(7).trim().toLowerCase().split(/\s+/)
    const bulanInput = parts[0]
    const bulanNum = BULAN_MAP[bulanInput] || parseInt(bulanInput)

    if (bulanNum && bulanNum >= 1 && bulanNum <= 12) {
      const now = new Date()
      const wib = new Date(now.getTime() + 8 * 60 * 60 * 1000)
      const tahun = parseInt(parts[1]) || wib.getFullYear()
      const unitFilter = parts[2]?.toUpperCase()

      const { units, perUnit, checks } = await getRekapBulanan(bulanNum, tahun)

      if (unitFilter) {
        // Rekap unit tertentu di bulan itu
        const unitChecks = checks.filter(c => c.unit_id === unitFilter)
        if (!unitChecks.length) {
          await sock.sendMessage(jid, { text: `❌ Tidak ada data ${unitFilter} di ${namaBulan(bulanNum)} ${tahun}` })
          return
        }
        const lines = unitChecks.map(c =>
          `• ${c.tanggal} Shift ${c.shift} — ${c.lokasi}`
        ).join('\n')
        await sock.sendMessage(jid, { text: `📋 *${unitFilter} — ${namaBulan(bulanNum)} ${tahun}*\n\n${lines}` })
      } else {
        // Rekap semua unit bulan itu
        const totalChecks = Object.values(perUnit).flat().length
        let out = `📊 *Rekap ${namaBulan(bulanNum)} ${tahun}*\n`
        out += `Total: ${units.length} unit | ${totalChecks} check\n\n`
        out += `Unit     Chk\n`
        out += `${'─'.repeat(20)}\n`
        for (const u of units) {
          const chk = (perUnit[u.unit_id] || []).length
          out += `${u.unit_id.padEnd(8)} ${chk}\n`
        }
        await sock.sendMessage(jid, { text: '```\n' + out + '```' })
      }
      return
    }

    // Fallback: !rekap DT5010 (history unit, bulan sekarang)
    const unitId = parts[0].toUpperCase()
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
            `!rekap [bulan] [tahun] — Rekap bulanan\n` +
            `!rekap [bulan] [tahun] [Unit] — Rekap unit tertentu\n` +
            `!ip [Unit] [IP] — Update IP unit\n` +
            `!batal — Batalkan proses aktif\n` +
            `!help — Menu ini`
    })
    return
  }
}

// ── HELPERS ───────────────────────────────────────────────────

async function handleDcPhoto(sock, jid, sender, session, mu, gsab, originalMsg) {
  const { unitId, lokasi } = session

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

  if (originalMsg?.message?.imageMessage) {
    const imageBuffer = await downloadMediaMessage(originalMsg, 'buffer', {}, {
      logger: { info: () => {}, error: console.error },
      reuploadRequest: sock.updateMediaMessage
    })
    await sock.sendMessage(jid, { image: imageBuffer, caption: template })
  } else {
    await sock.sendMessage(jid, { text: template })
  }
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
    const imageBuffer = await downloadMediaMessage(originalMsg, 'buffer', {}, {
      logger: { info: () => {}, error: console.error },
      reuploadRequest: sock.updateMediaMessage
    })
    await sock.sendMessage(jid, { image: imageBuffer, caption: template })
  } else {
    await sock.sendMessage(jid, { text: template })
  }
}
