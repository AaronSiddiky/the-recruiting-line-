import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { disconnect } from '@/lib/spotify/server'

export async function DELETE() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  await disconnect(user.id)
  return NextResponse.json({ ok: true })
}
