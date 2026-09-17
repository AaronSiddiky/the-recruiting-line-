import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { dailyScoreboard, scoreboardKey } from '@/lib/stats/daily'

export const dynamic = 'force-dynamic'

const DATE = /^\d{4}-\d{2}-\d{2}$/

async function load(params: Promise<{ key: string; date: string }>) {
  const { key, date } = await params
  if (key !== scoreboardKey() || !DATE.test(date)) return null
  return dailyScoreboard(date)
}

export async function generateMetadata(props: PageProps<'/scoreboard/[key]/[date]'>): Promise<Metadata> {
  const board = await load(props.params)
  if (!board) return { title: 'Scoreboard' }
  const line = board.reps.map((r) => `${r.name} ${r.calls}`).join(' · ')
  const title = `Daily scoreboard · ${board.label}`
  const description = `${line} calls. Keep it up buddy, you are almost there.`
  return {
    title,
    description,
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function ScoreboardPage(props: PageProps<'/scoreboard/[key]/[date]'>) {
  const board = await load(props.params)
  if (!board) notFound()
  const leader = [...board.reps].sort((a, b) => b.calls - a.calls)[0]

  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: '40px 24px' }}>
      <p style={{ margin: 0, fontSize: 13, letterSpacing: '.12em', textTransform: 'uppercase', color: '#9aa3a0' }}>The Recruiting Line · daily scoreboard</p>
      <h1 style={{ margin: '6px 0 24px', fontSize: 28, fontWeight: 800 }}>{board.label}</h1>

      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.max(1, board.reps.length)}, 1fr)`, gap: 12 }}>
        {board.reps.map((r) => {
          const pct = Math.min(100, Math.round((r.calls / board.goal) * 100))
          const lead = leader && r.id === leader.id && leader.calls > 0
          return (
            <section key={r.id} style={{ background: '#171a1f', border: `2px solid ${lead ? '#1DB954' : '#2a2f36'}`, borderRadius: 12, padding: 18 }}>
              <p style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{r.name}{lead ? ' 🏆' : ''}</p>
              <p style={{ margin: '10px 0 0', fontSize: 44, fontWeight: 900, lineHeight: 1 }}>{r.calls}</p>
              <p style={{ margin: '2px 0 12px', fontSize: 12, color: '#9aa3a0' }}>calls of {board.goal}</p>
              <div style={{ height: 8, background: '#2a2f36', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: '#1DB954' }} />
              </div>
              <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, margin: '14px 0 0', fontSize: 12 }}>
                <Stat n={r.pickups} l="picked up" /><Stat n={r.interested} l="interested" /><Stat n={r.customers} l="customers" />
              </dl>
            </section>
          )
        })}
      </div>

      <p style={{ marginTop: 28, fontSize: 20, fontWeight: 700, color: '#1DB954' }}>Keep it up buddy, you are almost there. 💪</p>
      <p style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>Counts one per logged outcome. Days in Eastern time.</p>
    </main>
  )
}

function Stat({ n, l }: { n: number; l: string }) {
  return (
    <div>
      <dt style={{ color: '#9aa3a0' }}>{l}</dt>
      <dd style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>{n}</dd>
    </div>
  )
}
