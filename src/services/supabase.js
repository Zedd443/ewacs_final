import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Ambil shift dari jam sekarang
export function getShift() {
  const hour = new Date().getHours()
  return hour >= 18 || hour < 6 ? 2 : 1
}

// Format tanggal Indonesia
export function getTanggal() {
  return new Date().toLocaleDateString('id-ID', {
    weekday: 'long', day: 'numeric',
    month: 'long', year: 'numeric'
  })
}

// Cek apakah unit ada di masterlist
export async function getUnit(unitId) {
  const { data } = await supabase
    .from('units')
    .select('*')
    .eq('unit_id', unitId.toUpperCase())
    .single()
  return data
}

// Simpan daily check
export async function saveDailyCheck(payload) {
  const { data, error } = await supabase
    .from('daily_checks')
    .insert(payload)

  // Update asset di tabel units kalau OCR berhasil
  if (payload.asset_mu && !payload.asset_mu.includes('?')) {
    await supabase
      .from('units')
      .update({ asset_mu: payload.asset_mu, asset_gsab: payload.asset_gsab })
      .eq('unit_id', payload.unit_id)
  }

  return { data, error }
}

// Simpan maintenance check
export async function saveMaintenanceCheck(payload) {
  const { data, error } = await supabase
    .from('maintenance_checks')
    .insert(payload)

  if (payload.asset_mu && !payload.asset_mu.includes('?')) {
    await supabase
      .from('units')
      .update({ asset_mu: payload.asset_mu, asset_gsab: payload.asset_gsab })
      .eq('unit_id', payload.unit_id)
  }

  return { data, error }
}

// Rekap shift hari ini
export async function getRekapShift(tanggal, shift) {
  // Unit yang sudah check
  const { data: sudah } = await supabase
    .from('daily_checks')
    .select('unit_id')
    .eq('tanggal', tanggal)
    .eq('shift', shift)

  // Semua unit aktif
  const { data: semua } = await supabase
    .from('units')
    .select('unit_id')
    .eq('aktif', true)

  const sudahIds = sudah?.map(d => d.unit_id) || []
  const belumIds = semua?.map(d => d.unit_id)
    .filter(id => !sudahIds.includes(id)) || []

  return { sudah: sudahIds, belum: belumIds }
}

// Rekap history satu unit
export async function getRekapUnit(unitId) {
  const { data } = await supabase
    .from('daily_checks')
    .select('*')
    .eq('unit_id', unitId.toUpperCase())
    .order('waktu', { ascending: false })
    .limit(5)
  return data
}

// Update IP unit (dari hasil remote putaran pertama)
export async function updateIP(unitId, ip) {
  const { data, error } = await supabase
    .from('units')
    .update({ ip })
    .eq('unit_id', unitId.toUpperCase())
  return { data, error }
}

// Generate hosts file content dari semua unit yang ada IP-nya
export async function generateHostsFile() {
  const { data } = await supabase
    .from('units')
    .select('unit_id, ip')
    .not('ip', 'is', null)
    .eq('aktif', true)

  return data?.map(u => `${u.ip}\t${u.unit_id}`).join('\n') || ''
}