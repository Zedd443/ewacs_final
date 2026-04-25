import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Shift berdasarkan jam WIB (UTC+8)
export function getShift() {
  const now = new Date()
  const wibHour = (now.getUTCHours() + 8) % 24
  return wibHour >= 18 || wibHour < 6 ? 2 : 1
}

// Tanggal WIB
export function getTanggal() {
  const now = new Date()
  const wib = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return wib.toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric',
    month: 'long', year: 'numeric'
  })
}

export async function getUnit(unitId) {
  const { data } = await supabase
    .from('units')
    .select('*')
    .eq('unit_id', unitId.toUpperCase())
    .single()
  return data
}

export async function saveDailyCheck(payload) {
  const { data, error } = await supabase
    .from('daily_checks')
    .insert(payload)

  if (payload.asset_mu && !payload.asset_mu.includes('?') && !payload.asset_mu.includes('x')) {
    await supabase
      .from('units')
      .update({ asset_mu: payload.asset_mu, asset_gsab: payload.asset_gsab })
      .eq('unit_id', payload.unit_id)
  }

  return { data, error }
}

export async function saveMaintenanceCheck(payload) {
  const { data, error } = await supabase
    .from('maintenance_checks')
    .insert(payload)

  if (payload.asset_mu && !payload.asset_mu.includes('?') && !payload.asset_mu.includes('x')) {
    await supabase
      .from('units')
      .update({ asset_mu: payload.asset_mu, asset_gsab: payload.asset_gsab })
      .eq('unit_id', payload.unit_id)
  }

  return { data, error }
}

export async function getRekapShift(tanggal, shift) {
  const { data: sudah } = await supabase
    .from('daily_checks')
    .select('unit_id')
    .eq('tanggal', tanggal)
    .eq('shift', shift)

  const { data: semua } = await supabase
    .from('units')
    .select('unit_id')
    .eq('aktif', true)

  const sudahIds = sudah?.map(d => d.unit_id) || []
  const belumIds = semua?.map(d => d.unit_id).filter(id => !sudahIds.includes(id)) || []

  return { sudah: sudahIds, belum: belumIds }
}

export async function getRekapUnit(unitId) {
  const { data } = await supabase
    .from('daily_checks')
    .select('*')
    .eq('unit_id', unitId.toUpperCase())
    .order('waktu', { ascending: false })
    .limit(5)
  return data
}

export async function updateIP(unitId, ip) {
  return await supabase
    .from('units')
    .update({ ip })
    .eq('unit_id', unitId.toUpperCase())
}

export async function generateHostsFile() {
  const { data } = await supabase
    .from('units')
    .select('unit_id, ip')
    .not('ip', 'is', null)
    .eq('aktif', true)
  return data?.map(u => `${u.ip}\t${u.unit_id}`).join('\n') || ''
}
