import { getShift, getTanggal } from '../services/supabase.js'

export function generateDailyCheck({ unitId, lokasi, mu, gsab }) {
  const tanggal = getTanggal()
  const shift = getShift()

  return `*DAILY CHECK EWACSPRO*\n` +
    `${tanggal} | Shift ${shift}\n\n` +
    `*No unit : ${unitId.toUpperCase()}*\n` +
    `Lokasi : ${formatLokasi(lokasi)}\n` +
    `Asset : ${mu || 'MU????'}\n` +
    `SN : ${gsab || 'GSAB?????'}\n` +
    `Status : All Oke ✅\n\n` +
    `_Backlog : -_`
}

export function generateMaintenanceCheck({ unitId, lokasi, mu, gsab, problem, penyebab, action, status, backlog = '-' }) {
  const tanggal = getTanggal()
  const shift = getShift()
  const statusFormatted = status?.toLowerCase() === 'closed' ? 'Closed ✅' : 'Open 🔴'

  return `*MAINTENANCE CHECK EWACSPRO*\n` +
    `${tanggal} | Shift ${shift}\n\n` +
    `*No unit : ${unitId.toUpperCase()}*\n` +
    `Problem : ${problem}\n` +
    `Penyebab : ${penyebab}\n` +
    `Action : ${action}\n` +
    `Lokasi : ${formatLokasi(lokasi)}\n` +
    `Asset : ${mu || 'MU????'}\n` +
    `SN : ${gsab || 'GSAB?????'}\n` +
    `Status : ${statusFormatted}\n\n` +
    `Backlog : ${backlog}`
}

function formatLokasi(lokasi) {
  if (!lokasi) return '-'
  const l = lokasi.toLowerCase().trim()
  const map = {
    'supernova'  : 'WS Supernova',
    'himalaya'   : 'PS Himalaya',
    'bengalon'   : 'WS Bengalon',
    'workshop'   : 'Workshop',
  }
  for (const [key, val] of Object.entries(map)) {
    if (l.includes(key)) return val
  }
  return lokasi.replace(/\b\w/g, c => c.toUpperCase())
}
