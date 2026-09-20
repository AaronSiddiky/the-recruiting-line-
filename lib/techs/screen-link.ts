import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'

/**
 * Screening links are signed rather than stored: the tech's id travels in the
 * URL with an HMAC beside it, so a link cannot be guessed, edited to point at
 * another person, or left behind in the database when a tech is deleted.
 */
export function signTech(techId: string): string {
  return createHmac('sha256', env.webhookSecret).update(`screen:${techId}`).digest('base64url').slice(0, 24)
}

export function verifyTech(techId: string, sig: string): boolean {
  const expected = Buffer.from(signTech(techId))
  const actual = Buffer.from(sig ?? '')
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function screenPath(techId: string): string {
  return `/screen/${techId}/${signTech(techId)}`
}

export function screenUrl(techId: string): string {
  return `${env.appUrl}${screenPath(techId)}`
}
