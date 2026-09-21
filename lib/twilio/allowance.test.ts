import { test } from 'node:test'
import assert from 'node:assert/strict'
import { repAllowance } from './allowance.ts'

/**
 * The scenario these exist for: two reps, one Twilio account, and both of them
 * on the phone at the same time. A rep on a call costs two slots -- the
 * prospect's leg and their own softphone line -- so two reps need four.
 */

const CAP = 4

test('a lone rep can dial', () => {
  // Their own line is the only thing live.
  assert.equal(repAllowance({ cap: CAP, agents: 1, myLive: 0, accountUsed: 1 }), 3)
})

test('both reps can dial while the other is idle', () => {
  // Two rep lines live, nothing else.
  const idle = { cap: CAP, agents: 2, myLive: 0, accountUsed: 2 }
  assert.equal(repAllowance(idle), 1)
})

test('a rep can dial while the other rep is already on a call', () => {
  // Two rep lines plus the other rep's prospect = 3 live. This is the case
  // that used to report "waiting for a free line" and made them take turns.
  assert.equal(repAllowance({ cap: CAP, agents: 2, myLive: 0, accountUsed: 3 }), 1)
})

test('both reps on a call at once leaves nothing over', () => {
  // Two rep lines plus two prospects = 4, the whole cap, and correctly so.
  assert.equal(repAllowance({ cap: CAP, agents: 2, myLive: 1, accountUsed: 4 }), 0)
})

test('a rep cannot open a second line of their own', () => {
  // One call at a time: their share is two slots and their line holds one.
  assert.equal(repAllowance({ cap: CAP, agents: 2, myLive: 1, accountUsed: 3 }), 0)
})

test('a rep cannot eat into the other rep’s share', () => {
  // Headroom exists account-wide, but it is reserved for the other rep.
  const greedy = repAllowance({ cap: 6, agents: 2, myLive: 2, accountUsed: 3 })
  assert.equal(greedy, 0)
})

test('three reps split a cap of six', () => {
  assert.equal(repAllowance({ cap: 6, agents: 3, myLive: 0, accountUsed: 3 }), 1)
  assert.equal(repAllowance({ cap: 6, agents: 3, myLive: 1, accountUsed: 4 }), 0)
})

test('a share too small to hold a call falls back to first-come', () => {
  // cap 3 over two reps is one slot each, which cannot hold a line plus a
  // prospect. Reserving it would leave both reps at zero forever, so they
  // contend for what is left instead.
  assert.equal(repAllowance({ cap: 3, agents: 2, myLive: 0, accountUsed: 2 }), 1)
  assert.equal(repAllowance({ cap: 3, agents: 2, myLive: 0, accountUsed: 3 }), 0)
})

test('never exceeds what the account has left', () => {
  // A stray leg nobody accounted for still closes the door.
  assert.equal(repAllowance({ cap: CAP, agents: 1, myLive: 0, accountUsed: 4 }), 0)
  assert.equal(repAllowance({ cap: CAP, agents: 1, myLive: 0, accountUsed: 9 }), 0)
})

test('never returns a negative allowance', () => {
  assert.equal(repAllowance({ cap: CAP, agents: 2, myLive: 5, accountUsed: 2 }), 0)
  assert.equal(repAllowance({ cap: 0, agents: 0, myLive: 0, accountUsed: 0 }), 0)
})
