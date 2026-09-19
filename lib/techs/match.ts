import { milesBetween } from '@/lib/geo/az'
import type { Client, Tech } from '@/types/db'

export type MatchClient = Pick<
  Client,
  'id' | 'role_type' | 'requires_own_tools' | 'commission_pay' | 'min_years' | 'epa_required' | 'pay_min' | 'pay_max' | 'openings' | 'status'
> & { company: { id: string; name: string; city: string | null } | null }

export type Match = {
  client: MatchClient
  score: number
  miles: number | null
  good: string[]
  concerns: string[]
  blocker: boolean
}

type TechFit = Pick<
  Tech,
  'city' | 'years_hvac' | 'epa_cert' | 'role_pref' | 'own_tools' | 'commission_ok' | 'pay_min' | 'max_commute_miles'
>

/**
 * Score how well a tech fits a client's opening, 0-100, with the reasons.
 * Unknowns score half: a blank screening card should not rank a tech below
 * one who plainly fails a requirement. A hard mismatch (no tools when tools
 * are required, pay floor above the client's ceiling) marks it a blocker.
 */
export function scoreMatch(tech: TechFit, client: MatchClient): Match {
  const good: string[] = []
  const concerns: string[] = []
  let blocker = false
  let score = 0

  // Distance, 30
  const miles = milesBetween(tech.city, client.company?.city)
  const reach = tech.max_commute_miles ?? 30
  if (miles == null) score += 15
  else if (miles <= reach) {
    score += Math.round(30 - (miles / Math.max(reach, 1)) * 12)
    good.push(`${miles} mi away`)
  } else if (miles <= reach * 1.5) {
    score += 8
    concerns.push(`${miles} mi away, past their ${reach} mi limit`)
  } else {
    concerns.push(`${miles} mi away`)
  }

  // Install vs service, 20
  if (!client.role_type || !tech.role_pref) score += 10
  else if (client.role_type === 'both' || tech.role_pref === 'both' || client.role_type === tech.role_pref) {
    score += 20
    good.push(tech.role_pref === 'both' ? 'does install and service' : `${tech.role_pref} work matches`)
  } else {
    concerns.push(`wants ${tech.role_pref}, opening is ${client.role_type}`)
  }

  // Own tools, 15
  if (!client.requires_own_tools) score += 15
  else if (tech.own_tools == null) score += 7
  else if (tech.own_tools) {
    score += 15
    good.push('has own tools')
  } else {
    concerns.push('no own tools')
    blocker = true
  }

  // Commission pay, 10
  if (!client.commission_pay) score += 10
  else if (tech.commission_ok == null) score += 5
  else if (tech.commission_ok) {
    score += 10
    good.push('OK with commission')
  } else concerns.push('does not want commission pay')

  // Experience, 15
  if (!client.min_years) score += tech.years_hvac != null ? 15 : 10
  else if (tech.years_hvac == null) score += 7
  else if (tech.years_hvac >= client.min_years) {
    score += 15
    good.push(`${tech.years_hvac} yrs HVAC`)
  } else concerns.push(`${tech.years_hvac} yrs, needs ${client.min_years}`)

  // EPA, 10
  if (!client.epa_required) score += 10
  else if (!tech.epa_cert) score += 5
  else if (tech.epa_cert !== 'none') {
    score += 10
    good.push(`EPA ${tech.epa_cert === 'universal' ? 'universal' : tech.epa_cert.replace('type', 'Type ')}`)
  } else concerns.push('no EPA cert')

  // Pay, penalty only
  if (tech.pay_min != null && client.pay_max != null && tech.pay_min > client.pay_max) {
    concerns.push(`wants $${tech.pay_min}/hr, max is $${client.pay_max}`)
    blocker = true
    score -= 15
  } else if (tech.pay_min != null && client.pay_max != null) {
    good.push(`pay fits ($${tech.pay_min}+ vs up to $${client.pay_max})`)
  }

  return { client, score: Math.max(0, Math.min(100, score)), miles, good, concerns, blocker }
}

export function rankMatches(tech: TechFit, clients: MatchClient[]): Match[] {
  return clients
    .filter((c) => c.status === 'active')
    .map((c) => scoreMatch(tech, c))
    .sort((a, b) => Number(a.blocker) - Number(b.blocker) || b.score - a.score)
}
