import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const BUCKET = 'contracts'
const MAX_BYTES = 15 * 1024 * 1024
const EXT_BY_TYPE: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'image/webp': 'webp',
}

async function guard(id: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Not signed in.' }, { status: 401 }) }
  // RLS decides whether this user may see the client.
  const { data: client } = await supabase.from('clients').select('id, contract_path').eq('id', id).maybeSingle()
  if (!client) return { error: NextResponse.json({ error: 'No such client.' }, { status: 404 }) }
  return { client }
}

/** Open the signed contract through a short-lived signed URL. */
export async function GET(_request: NextRequest, ctx: RouteContext<'/api/clients/[id]/contract'>) {
  const { id } = await ctx.params
  const g = await guard(id)
  if ('error' in g) return g.error
  if (!g.client.contract_path) return NextResponse.json({ error: 'No contract uploaded.' }, { status: 404 })

  const { data, error } = await createAdminClient().storage.from(BUCKET).createSignedUrl(g.client.contract_path, 60 * 10)
  if (error || !data) return NextResponse.json({ error: 'Could not open the contract.' }, { status: 500 })
  return NextResponse.redirect(data.signedUrl)
}

/** Upload or replace the signed contract (PDF or a photo). */
export async function POST(request: NextRequest, ctx: RouteContext<'/api/clients/[id]/contract'>) {
  const { id } = await ctx.params
  const g = await guard(id)
  if ('error' in g) return g.error

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'No file.' }, { status: 400 })
  const ext = EXT_BY_TYPE[file.type]
  if (!ext) return NextResponse.json({ error: 'Use a PDF or a photo (JPG, PNG, HEIC).' }, { status: 400 })
  if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Keep the file under 15 MB.' }, { status: 400 })

  const admin = createAdminClient()
  const path = `${id}/contract-${Date.now()}.${ext}`
  const bytes = Buffer.from(await file.arrayBuffer())
  let { error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: file.type })
  if (uploadError && /bucket not found/i.test(uploadError.message)) {
    await admin.storage.createBucket(BUCKET, { public: false }).catch(() => undefined)
    ;({ error: uploadError } = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: file.type }))
  }
  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  if (g.client.contract_path) {
    await admin.storage.from(BUCKET).remove([g.client.contract_path]).catch(() => undefined)
  }
  const { error } = await admin.from('clients').update({ contract_path: path }).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_request: NextRequest, ctx: RouteContext<'/api/clients/[id]/contract'>) {
  const { id } = await ctx.params
  const g = await guard(id)
  if ('error' in g) return g.error
  const admin = createAdminClient()
  if (g.client.contract_path) await admin.storage.from(BUCKET).remove([g.client.contract_path]).catch(() => undefined)
  await admin.from('clients').update({ contract_path: null }).eq('id', id)
  return NextResponse.json({ ok: true })
}
