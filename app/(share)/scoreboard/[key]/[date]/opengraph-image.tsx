import { ImageResponse } from 'next/og'
import { dailyScoreboard, scoreboardKey } from '@/lib/stats/daily'

export const alt = 'Daily scoreboard'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const dynamic = 'force-dynamic'

/** The preview card messaging apps unfurl: the day's numbers, side by side. */
export default async function Image({ params }: { params: Promise<{ key: string; date: string }> }) {
  const { key, date } = await params
  const ok = key === scoreboardKey() && /^\d{4}-\d{2}-\d{2}$/.test(date)
  const board = ok ? await dailyScoreboard(date) : null
  const leader = board ? [...board.reps].sort((a, b) => b.calls - a.calls)[0] : null

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', background: '#0f1115', color: '#f5f5f5', padding: 56, fontFamily: 'sans-serif' }}>
        <div style={{ display: 'flex', fontSize: 22, letterSpacing: 4, color: '#9aa3a0', textTransform: 'uppercase' }}>The Recruiting Line · Daily scoreboard</div>
        <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, marginTop: 6 }}>{board?.label ?? 'Scoreboard'}</div>

        <div style={{ display: 'flex', gap: 28, marginTop: 36, flex: 1 }}>
          {(board?.reps ?? []).map((r) => {
            const pct = Math.min(100, Math.round((r.calls / (board?.goal ?? 50)) * 100))
            const lead = leader && r.id === leader.id && leader.calls > 0
            return (
              <div key={r.id} style={{ display: 'flex', flexDirection: 'column', flex: 1, background: '#171a1f', border: `4px solid ${lead ? '#1DB954' : '#2a2f36'}`, borderRadius: 20, padding: 32 }}>
                <div style={{ display: 'flex', fontSize: 34, fontWeight: 700, lineHeight: 1.2 }}>{r.name}{lead ? ' 🏆' : ''}</div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 22 }}>
                  <div style={{ display: 'flex', fontSize: 110, fontWeight: 900, lineHeight: 1 }}>{r.calls}</div>
                  <div style={{ display: 'flex', fontSize: 26, color: '#9aa3a0' }}>calls of {board?.goal}</div>
                </div>
                <div style={{ display: 'flex', height: 16, background: '#2a2f36', borderRadius: 8, marginTop: 18, overflow: 'hidden' }}>
                  <div style={{ display: 'flex', width: `${pct}%`, background: '#1DB954' }} />
                </div>
                <div style={{ display: 'flex', gap: 30, marginTop: 22, fontSize: 24, color: '#c9d1cd' }}>
                  <div style={{ display: 'flex' }}>{r.pickups} picked up</div>
                  <div style={{ display: 'flex' }}>{r.interested} interested</div>
                  <div style={{ display: 'flex' }}>{r.customers} customers</div>
                </div>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', fontSize: 36, fontWeight: 700, color: '#1DB954', marginTop: 28 }}>Keep it up buddy, you are almost there. 💪</div>
      </div>
    ),
    size,
  )
}
