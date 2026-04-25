// In-memory session store
// Key: nomor WA, Value: state object
const sessions = new Map()

export function getSession(jid) {
  return sessions.get(jid) || null
}

export function setSession(jid, data) {
  sessions.set(jid, { ...data, updatedAt: Date.now() })
}

export function clearSession(jid) {
  sessions.delete(jid)
}

// Bersihkan session yang sudah lebih dari 10 menit tidak aktif
setInterval(() => {
  const now = Date.now()
  for (const [jid, session] of sessions.entries()) {
    if (now - session.updatedAt > 10 * 60 * 1000) {
      sessions.delete(jid)
    }
  }
}, 60 * 1000)