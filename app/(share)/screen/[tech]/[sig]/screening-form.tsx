'use client'

import { useState } from 'react'

type Tech = {
  name: string | null
  city: string | null
  state: string | null
  title: string | null
  employer: string | null
  years_hvac: number | null
  role_pref: 'install' | 'service' | 'both' | null
  epa_cert: 'none' | 'type1' | 'type2' | 'type3' | 'universal' | null
  own_tools: boolean | null
  drivers_license: boolean | null
  commission_ok: boolean | null
  pay_min: number | null
  available_from: string | null
  max_commute_miles: number | null
  current_job: string | null
  screening_at: string | null
}

const yn = (v: boolean | null) => (v == null ? '' : v ? 'yes' : 'no')

/**
 * What a technician fills in on their phone. Plain, large controls and one
 * question per line: this is opened on a job site, one-handed, in the sun.
 */
export function ScreeningForm({ tech, action }: { tech: Tech; action: string }) {
  const [looking, setLooking] = useState<'' | 'yes' | 'no'>('')
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const f = new FormData(e.currentTarget)
    const str = (k: string) => (String(f.get(k) ?? '').trim() || undefined)
    const num = (k: string) => {
      const v = str(k)
      return v === undefined ? undefined : Number(v)
    }
    const bool = (k: string) => {
      const v = str(k)
      return v === undefined ? undefined : v === 'yes'
    }
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(action, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          looking: looking === 'yes',
          name: str('name'),
          email: str('email'),
          city: str('city'),
          current_job: str('current_job'),
          years_hvac: num('years_hvac'),
          role_pref: str('role_pref'),
          epa_cert: str('epa_cert'),
          own_tools: bool('own_tools'),
          drivers_license: bool('drivers_license'),
          commission_ok: bool('commission_ok'),
          pay_min: num('pay_min'),
          available_from: str('available_from'),
          max_commute_miles: num('max_commute_miles'),
          note: str('note'),
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? 'Could not send your answers.')
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your answers.')
    } finally {
      setBusy(false)
    }
  }

  const first = (tech.name ?? '').split(' ')[0]

  if (done) {
    return (
      <main style={{ maxWidth: 560, margin: '0 auto', padding: '56px 24px' }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Thanks{first ? `, ${first}` : ''}.</h1>
        <p style={{ marginTop: 10, color: '#b9c0bd', fontSize: 16, lineHeight: 1.5 }}>
          {looking === 'yes'
            ? 'Got it. We place HVAC techs with shops around the Phoenix valley, and we will call you when something fits.'
            : 'No problem. We will check back in a couple of months in case things change.'}
        </p>
        <p style={{ marginTop: 24, color: '#6b7280', fontSize: 13 }}>The Recruiting Line</p>
      </main>
    )
  }

  const label: React.CSSProperties = { display: 'block', fontSize: 13, color: '#b9c0bd', marginBottom: 6 }
  const input: React.CSSProperties = {
    width: '100%', height: 44, borderRadius: 10, border: '1px solid #2a2f36', background: '#171a1f',
    color: '#f5f5f5', padding: '0 12px', fontSize: 16, boxSizing: 'border-box',
  }
  const row: React.CSSProperties = { marginBottom: 16 }

  return (
    <main style={{ maxWidth: 560, margin: '0 auto', padding: '40px 24px 64px' }}>
      <p style={{ margin: 0, fontSize: 12, letterSpacing: '.14em', textTransform: 'uppercase', color: '#9aa3a0' }}>The Recruiting Line</p>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: '8px 0 6px' }}>
        {first ? `${first}, a few quick questions` : 'A few quick questions'}
      </h1>
      <p style={{ margin: '0 0 24px', color: '#b9c0bd', fontSize: 15, lineHeight: 1.5 }}>
        We place HVAC techs with shops around the valley. This takes a minute and means we only call you about jobs that actually fit.
      </p>

      <form onSubmit={submit}>
        <fieldset style={{ border: 0, padding: 0, margin: '0 0 20px' }}>
          <legend style={{ ...label, marginBottom: 10 }}>Are you still looking for work?</legend>
          <div style={{ display: 'flex', gap: 10 }}>
            {(['yes', 'no'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setLooking(v)}
                style={{
                  flex: 1, height: 48, borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer',
                  border: `2px solid ${looking === v ? '#1DB954' : '#2a2f36'}`,
                  background: looking === v ? 'rgba(29,185,84,.12)' : '#171a1f',
                  color: looking === v ? '#1DB954' : '#f5f5f5',
                }}
              >
                {v === 'yes' ? 'Yes, I am' : 'Not right now'}
              </button>
            ))}
          </div>
        </fieldset>

        {looking === 'yes' && (
          <>
            {!tech.name && (
              <div style={row}><label style={label} htmlFor="name">Your name</label><input style={input} id="name" name="name" autoComplete="name" required /></div>
            )}
            <div style={row}><label style={label} htmlFor="current_job">What are you doing now?</label>
              <input style={input} id="current_job" name="current_job" defaultValue={tech.current_job ?? [tech.title, tech.employer].filter(Boolean).join(' at ')} placeholder="HVAC tech at Acme Air" />
            </div>
            <div style={row}><label style={label} htmlFor="years_hvac">Years in HVAC</label>
              <input style={input} id="years_hvac" name="years_hvac" type="number" min={0} step={0.5} inputMode="decimal" defaultValue={tech.years_hvac ?? ''} />
            </div>
            <div style={row}><label style={label} htmlFor="role_pref">Install, service, or both?</label>
              <select style={input} id="role_pref" name="role_pref" defaultValue={tech.role_pref ?? ''}>
                <option value="">Pick one</option><option value="install">Install</option><option value="service">Service</option><option value="both">Both</option>
              </select>
            </div>
            <div style={row}><label style={label} htmlFor="epa_cert">EPA certification</label>
              <select style={input} id="epa_cert" name="epa_cert" defaultValue={tech.epa_cert ?? ''}>
                <option value="">Pick one</option><option value="universal">Universal</option><option value="type1">Type I</option><option value="type2">Type II</option><option value="type3">Type III</option><option value="none">None yet</option>
              </select>
            </div>
            <div style={row}><label style={label} htmlFor="own_tools">Do you have your own tools?</label>
              <select style={input} id="own_tools" name="own_tools" defaultValue={yn(tech.own_tools)}><option value="">Pick one</option><option value="yes">Yes</option><option value="no">No</option></select>
            </div>
            <div style={row}><label style={label} htmlFor="drivers_license">Valid driver&rsquo;s licence?</label>
              <select style={input} id="drivers_license" name="drivers_license" defaultValue={yn(tech.drivers_license)}><option value="">Pick one</option><option value="yes">Yes</option><option value="no">No</option></select>
            </div>
            <div style={row}><label style={label} htmlFor="commission_ok">Open to commission-based pay?</label>
              <select style={input} id="commission_ok" name="commission_ok" defaultValue={yn(tech.commission_ok)}><option value="">Pick one</option><option value="yes">Yes</option><option value="no">No</option></select>
            </div>
            <div style={row}><label style={label} htmlFor="pay_min">Hourly pay you need ($)</label>
              <input style={input} id="pay_min" name="pay_min" type="number" min={0} inputMode="numeric" defaultValue={tech.pay_min ?? ''} placeholder="32" />
            </div>
            <div style={row}><label style={label} htmlFor="available_from">When can you start?</label>
              <input style={input} id="available_from" name="available_from" type="date" defaultValue={tech.available_from ?? ''} />
            </div>
            <div style={row}><label style={label} htmlFor="city">Which town do you live in?</label>
              <input style={input} id="city" name="city" defaultValue={tech.city ?? ''} placeholder="Phoenix" />
            </div>
            <div style={row}><label style={label} htmlFor="max_commute_miles">How far will you drive to work? (miles)</label>
              <input style={input} id="max_commute_miles" name="max_commute_miles" type="number" min={0} inputMode="numeric" defaultValue={tech.max_commute_miles ?? 30} />
            </div>
            <div style={row}><label style={label} htmlFor="email">Email</label>
              <input style={input} id="email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="you@gmail.com" />
            </div>
            <div style={row}><label style={label} htmlFor="note">Anything else we should know?</label>
              <textarea style={{ ...input, height: 90, padding: 12 }} id="note" name="note" rows={3} />
            </div>
          </>
        )}

        {error && <p style={{ color: '#f15e6c', fontSize: 14 }}>{error}</p>}

        <button
          type="submit"
          disabled={busy || !looking}
          style={{
            width: '100%', height: 52, marginTop: 8, borderRadius: 10, border: 0, cursor: 'pointer',
            background: looking ? '#1DB954' : '#2a2f36', color: looking ? '#000' : '#6b7280', fontSize: 17, fontWeight: 700,
          }}
        >
          {busy ? 'Sending…' : 'Send my answers'}
        </button>
        <p style={{ marginTop: 14, color: '#6b7280', fontSize: 12 }}>
          Your answers go to The Recruiting Line only, and we use them to match you to HVAC shops that are hiring.
        </p>
      </form>
    </main>
  )
}
