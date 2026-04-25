import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

// Rekap bulanan — list unit + berapa kali check bulan ini
export async function getRekapBulanan(bulan, tahun) {
  const startDate = `${tahun}-${String(bulan).padStart(2, '0')}-01`
  const endDate   = `${tahun}-${String(bulan).padStart(2, '0')}-31`

  const { data: checks } = await supabase
    .from('daily_checks')
    .select('unit_id, tanggal, shift, lokasi, asset_mu, asset_gsab, status')
    .gte('tanggal', startDate)
    .lte('tanggal', endDate)
    .order('tanggal', { ascending: true })

  const { data: units } = await supabase
    .from('units')
    .select('unit_id, asset_mu, asset_gsab, ip')
    .eq('aktif', true)
    .order('unit_id')

  // Group checks per unit
  const perUnit = {}
  for (const c of checks || []) {
    if (!perUnit[c.unit_id]) perUnit[c.unit_id] = []
    perUnit[c.unit_id].push(c)
  }

  return { units: units || [], perUnit, checks: checks || [] }
}

// Nama bulan Indonesia
export function namaBulan(bulan) {
  const names = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']
  return names[bulan]
}
