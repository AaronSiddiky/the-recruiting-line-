import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'voicemails'
const MAX_BYTES = 8 * 1024 * 1024

/** Twilio <Play> formats we accept. Browser recordings arrive as WAV. */
const EXT_BY_TYPE: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
}

async function currentUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

/** Stream the signed-in rep's own message, for the preview player. */
export async function GET() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('voicemail_path')
    .eq('id', user.id)
    .maybeSingle()
  if (!profile?.voicemail_path) {
    return NextResponse.json({ error: 'No voicemail recorded.' }, { status: 404 })
  }

  const { data, error } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(profile.voicemail_path, 60 * 10)
  if (error || !data) {
    return NextResponse.json({ error: 'Could not sign recording.' }, { status: 500 })
  }
  return NextResponse.redirect(data.signedUrl)
}

/** Replace the rep's message with an uploaded or browser-recorded file. */
export async function POST(request: NextRequest) {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No audio file.' }, { status: 400 })
  }
  const ext = EXT_BY_TYPE[file.type]
  if (!ext) {
    return NextResponse.json(
      { error: 'Use a WAV or MP3 file. Voice Memos exports (.m4a) need converting first.' },
      { status: 400 },
    )
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Keep the message under 8 MB.' }, { status: 400 })
  }

  const admin = createAdminClient()
  const path = `${user.id}.${ext}`
  const bytes = Buffer.from(await file.arrayBuffer())
  const options = { contentType: file.type, upsert: true }

  let { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, options)

  // The bucket is normally created by migration 0010, but the service role can
  // make it on the spot, so a missing bucket is not worth a support round-trip.
  if (uploadError && /bucket not found/i.test(uploadError.message)) {
    const { error: createError } = await admin.storage.createBucket(BUCKET, { public: false })
    if (createError && !/already exists/i.test(createError.message)) {
      return NextResponse.json({ error: createError.message }, { status: 500 })
    }
    ;({ error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, options))
  }
  if (uploadError) {
    return NextResponse.json({ error: uploadError.message }, { status: 500 })
  }

  // Changing format leaves the old extension behind; tidy it.
  const { data: profile } = await admin
    .from('profiles')
    .select('voicemail_path')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.voicemail_path && profile.voicemail_path !== path) {
    await admin.storage.from(BUCKET).remove([profile.voicemail_path]).catch(() => undefined)
  }

  const { error: profileError } = await admin
    .from('profiles')
    .update({ voicemail_path: path })
    .eq('id', user.id)
  if (profileError) {
    return NextResponse.json(
      {
        error: /voicemail_path/.test(profileError.message)
          ? 'Saved the file, but the database is missing the voicemail column. Run supabase/migrations/0010_voicemail_drop.sql.'
          : profileError.message,
      },
      { status: 500 },
    )
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE() {
  const user = await currentUser()
  if (!user) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const admin = createAdminClient()
  const { data: profile } = await admin
    .from('profiles')
    .select('voicemail_path')
    .eq('id', user.id)
    .maybeSingle()
  if (profile?.voicemail_path) {
    await admin.storage.from(BUCKET).remove([profile.voicemail_path]).catch(() => undefined)
  }
  await admin.from('profiles').update({ voicemail_path: null }).eq('id', user.id)
  return NextResponse.json({ ok: true })
}
