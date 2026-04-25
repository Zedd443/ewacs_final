import { createClient } from '@supabase/supabase-js'
import { BufferJSON, initAuthCreds } from '@whiskeysockets/baileys'

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
)

const TABLE = 'auth_session'

export async function useSupabaseAuthState() {
  // Pastikan tabel ada — buat kalau belum
  const readData = async (key) => {
    const { data } = await supabase
      .from(TABLE)
      .select('value')
      .eq('key', key)
      .single()
    if (!data) return null
    return JSON.parse(data.value, BufferJSON.reviver)
  }

  const writeData = async (key, value) => {
    const serialized = JSON.stringify(value, BufferJSON.replacer)
    const { error } = await supabase
      .from(TABLE)
      .upsert({ key, value: serialized }, { onConflict: 'key' })
    if (error) console.error(`[authState] write error (${key}):`, error.message)
  }

  const removeData = async (key) => {
    await supabase.from(TABLE).delete().eq('key', key)
  }

  // Load atau buat credentials baru
  const creds = await readData('creds') || initAuthCreds()

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {}
          for (const id of ids) {
            const val = await readData(`${type}-${id}`)
            if (val) data[id] = val
          }
          return data
        },
        set: async (data) => {
          for (const [type, ids] of Object.entries(data)) {
            for (const [id, value] of Object.entries(ids)) {
              if (value) {
                await writeData(`${type}-${id}`, value)
              } else {
                await removeData(`${type}-${id}`)
              }
            }
          }
        }
      }
    },
    saveCreds: async () => {
      await writeData('creds', creds)
      console.log('[authState] creds saved')
    }
  }
}
