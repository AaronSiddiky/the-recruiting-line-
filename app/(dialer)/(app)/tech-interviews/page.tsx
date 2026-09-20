import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { rankMatches, type MatchClient } from '@/lib/techs/match'
import { formatPhone } from '@/lib/utils'
import type { Tech } from '@/types/db'

/** Techs in the Tech interview stage, soonest interview first, each with their best client match. */
export default async function TechInterviewsPage() {
  const supabase = await createClient()
  const [{ data: techs, error }, { data: clients }] = await Promise.all([
    supabase.from('techs').select('*').eq('status', 'interviewing').order('interview_at', { ascending: true, nullsFirst: false }),
    supabase.from('clients').select('id, status, role_type, requires_own_tools, commission_pay, min_years, epa_required, pay_min, pay_max, openings, company:companies(id, name, city)'),
  ])
  const rows = (techs ?? []) as Tech[]
  const cls = (clients ?? []) as unknown as MatchClient[]
  const now = new Date().toISOString()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-2.5">
        <h1 className="text-sm font-semibold">Tech interviews</h1>
        <span className="tnum text-xs text-muted">{rows.length} in this stage</span>
        <span className="ml-auto text-xs text-muted">Set a time on a tech&rsquo;s page, or pick &ldquo;Tech interview&rdquo; as their stage.</span>
      </div>
      {error ? (
        <div className="m-4 rounded-md border border-bad-bg bg-bad-bg px-3 py-2 text-sm text-bad">Could not load: {error.message}{/interview_at|schema cache/.test(error.message) && ' — run supabase/migrations/0022_tech_pipeline.sql.'}</div>
      ) : rows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-12 text-center"><div><p className="text-sm font-medium">No tech interviews yet.</p><p className="mt-1 text-xs text-muted">Techs marked Interested on a call move to Screened; schedule their interview from their page.</p></div></div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full border-separate border-spacing-0 text-sm">
            <thead className="sticky top-0 z-10"><tr>
              {['When', 'Tech', 'Phone', 'Background', 'Screening', 'Best match', 'Notes'].map((h) => <th key={h} className="border-b border-border-subtle bg-surface px-3 py-2 text-left text-xs font-medium whitespace-nowrap text-muted">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((t) => {
                const best = rankMatches(t, cls)[0]
                const past = t.interview_at && t.interview_at < now
                return (
                  <tr key={t.id} className="align-top hover:bg-surface">
                    <td className={`tnum border-b border-border-subtle px-3 py-2 whitespace-nowrap ${past ? 'text-muted' : 'font-medium'}`}>{t.interview_at ? new Date(t.interview_at).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : <span className="text-bad">Not scheduled</span>}</td>
                    <td className="border-b border-border-subtle px-3 py-2"><Link href={`/techs/${t.id}`} className="font-medium hover:text-accent hover:underline">{t.name ?? 'Applicant'}</Link><div className="text-xs text-muted">{[t.city, t.state].filter(Boolean).join(', ')}</div></td>
                    <td className="tnum border-b border-border-subtle px-3 py-2 whitespace-nowrap">{t.phone ? <a href={`tel:${t.phone}`} className="hover:text-accent">{formatPhone(t.phone)}</a> : '—'}</td>
                    <td className="max-w-xs border-b border-border-subtle px-3 py-2 text-xs">{[t.title, t.employer].filter(Boolean).join(' at ')}</td>
                    <td className="border-b border-border-subtle px-3 py-2 text-xs whitespace-nowrap">
                      {t.screening_at && <span className="mr-1.5 rounded bg-good-bg px-1 text-[10px] font-semibold text-good">form</span>}
                      {[t.years_hvac != null && `${t.years_hvac} yrs`, t.role_pref, t.epa_cert && t.epa_cert !== 'none' && `EPA ${t.epa_cert}`, t.own_tools && 'tools', t.pay_min && `$${t.pay_min}+/hr`].filter(Boolean).join(' · ') || <span className="text-muted-2">not screened</span>}
                    </td>
                    <td className="border-b border-border-subtle px-3 py-2 whitespace-nowrap">{best ? <span><span className={`tnum mr-1.5 font-semibold ${best.blocker ? 'text-bad' : best.score >= 70 ? 'text-good' : 'text-warn'}`}>{best.score}</span>{best.client.company?.name}</span> : '—'}</td>
                    <td className="max-w-xs border-b border-border-subtle px-3 py-2 text-xs"><span className="line-clamp-2">{t.interview_notes ?? ''}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
