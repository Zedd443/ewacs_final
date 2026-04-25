const { getShiftInfo } = require('../utils/shift')

function generateDailyCheck({ unit, lokasi, mu, gsab }) {
  const { shift, dateStr } = getShiftInfo()
  const muStr = mu || 'MU????'
  const gsabStr = gsab || 'GSAB?????'

  return (
    `*DAILY CHECK EWACSPRO*\n` +
    `${dateStr} | Shift ${shift}\n\n` +
    `*No unit : ${unit}*\n` +
    `Lokasi : ${formatLokasi(lokasi)}\n` +
    `Asset : ${muStr}\n` +
    `SN : ${gsabStr}\n` +
    `Status : All Oke ✅\n\n` +
    `_Backlog : -_`
  )
}

function generateMaintenance({ unit, lokasi, mu, gsab, problem, penyebab, action, status, backlog }) {
  const { shift, dateStr } = getShiftInfo()
  const muStr = mu || 'MU????'
  const gsabStr = gsab || 'GSAB?????'
  const statusStr = status?.toLowerCase() === 'closed'
    ? 'Closed ✅'
    : 'Open 🔴'
  const backlogStr = backlog || '-'

  return (
    `*MAINTENANCE CHECK EWACSPRO*\n` +
    `${dateStr} | Shift ${shift}\n\n` +
    `*No unit : ${unit}*\n` +
    `Problem : ${problem}\n` +
    `Penyebab : ${penyebab}\n` +
    `Action : ${action}\n` +
    `Lokasi : ${formatLokasi(lokasi)}\n` +
    `Asset : ${muStr}\n` +
    `SN : ${gsabStr}\n` +
    `Status : ${statusStr}\n\n` +
    `Backlog : ${backlogStr}`
  )
}

// Format lokasi jadi title case dengan prefix WS/PS kalau belum ada
function formatLokasi(lokasi) {
  if (!lokasi) return '-'
  const lower = lokasi.toLowerCase()
  // Kalau sudah ada prefix, return as-is dengan title case
  if (lower.startsWith('ws ') || lower.startsWith('ps ')) {
    return lokasi.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
  }
  // Default prefix WS
  return 'WS ' + lokasi.replace(/\w\S*/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

module.exports = { generateDailyCheck, generateMaintenance }