/**
 * How many calls this rep may still place, given the account's cap.
 *
 * Twilio counts every live call against the cap, each rep's softphone leg
 * included, and rejects anything over it with error 10004 and no webhook -- so
 * it is far cheaper to not ask than to find out.
 *
 * The cap is split into a reserved share per rep rather than being a pool they
 * race for. A rep on a call needs two slots (the prospect's leg and their own
 * line), so a pool let whoever asked first take the last slot and left the
 * other rep watching "waiting for a free line" for the length of a call. With
 * a share each, both reps can be on the phone at the same time.
 *
 * Pure so it can be exercised without a database or Twilio; see allowance.test.ts.
 */
export function repAllowance({
  cap,
  agents,
  myLive,
  accountUsed,
}: {
  cap: number
  /** Reps holding a line on this account right now, this one included. */
  agents: number
  /** This rep's own legs already dialing, ringing or connected. */
  myLive: number
  /** Every call live on the account, every rep's own line included. */
  accountUsed: number
}): number {
  const share = Math.floor(cap / Math.max(1, agents))
  const headroom = Math.max(0, cap - accountUsed)
  // A share below 2 cannot hold a rep's own line plus one prospect. Reserving
  // it would deadlock every rep at zero, so fall back to first-come on what is
  // left -- the reps take turns, which is at least someone dialing.
  const allowance = share < 2 ? headroom : share - 1 - myLive
  return Math.max(0, Math.min(allowance, headroom))
}
