import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { ClientDetail } from './client-detail'
import type { Client, ClientTouchpoint, Profile } from '@/types/db'

export default async function ClientPage(props: PageProps<'/clients/[id]'>) {
  const { id } = await props.params
  const supabase = await createClient()

  const [{ data: client }, { data: profiles }, { data: touches }] = await Promise.all([
    supabase.from('clients').select('*, company:companies(id, name, phone, email, city, state)').eq('id', id).maybeSingle(),
    supabase.from('profiles').select('id, full_name').order('full_name'),
    supabase
      .from('client_touchpoints')
      .select('*, author:profiles!client_touchpoints_user_id_fkey(id, full_name)')
      .eq('client_id', id)
      .order('at', { ascending: false }),
  ])
  if (!client) notFound()

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-5">
      <Link href="/clients" className="inline-flex items-center gap-1 text-xs text-muted hover:text-foreground">
        <ArrowLeft className="size-3" aria-hidden />
        Back to clients
      </Link>
      <ClientDetail
        client={client as unknown as Client & { company: { id: string; name: string; phone: string | null; email: string | null; city: string | null; state: string | null } | null }}
        profiles={(profiles ?? []) as Pick<Profile, 'id' | 'full_name'>[]}
        touchpoints={(touches ?? []) as unknown as (ClientTouchpoint & { author: { id: string; full_name: string } | null })[]}
      />
    </div>
  )
}
