'use client'

import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, Music, X } from 'lucide-react'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'dialer.spotify'

/** open.spotify.com/{type}/{id} or spotify:{type}:{id} → embed URL, or null. */
function toEmbed(input: string): string | null {
  const t = input.trim()
  const web = /open\.spotify\.com\/(?:intl-[a-z]+\/)?(playlist|album|track|show|episode|artist)\/([A-Za-z0-9]+)/.exec(t)
  const uri = /^spotify:(playlist|album|track|show|episode|artist):([A-Za-z0-9]+)$/.exec(t)
  const m = web ?? uri
  return m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}?theme=0` : null
}

/**
 * A Spotify player that lives outside the call phases, so music keeps going
 * between batches and through a call. Playback runs through the rep's
 * speakers or headphones, never into the call.
 */
export function SpotifyPanel() {
  const [embed, setEmbed] = useState<string | null>(null)
  const [open, setOpen] = useState(true)
  const [draft, setDraft] = useState('')
  const [bad, setBad] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      // Deferred so the first paint matches the server render; storage only
      // exists in the browser.
      if (saved) queueMicrotask(() => setEmbed(saved))
    } catch {
      // Private mode or blocked storage: the panel just starts empty.
    }
  }, [])

  function save(url: string | null) {
    setEmbed(url)
    try {
      if (url) localStorage.setItem(STORAGE_KEY, url)
      else localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore; the choice lasts for this page load.
    }
  }

  function submit() {
    const url = toEmbed(draft)
    if (!url) {
      setBad(true)
      return
    }
    setBad(false)
    setDraft('')
    save(url)
    setOpen(true)
  }

  return (
    <aside
      aria-label="Spotify"
      className="fixed right-4 bottom-4 z-40 w-80 overflow-hidden rounded-lg border border-border-subtle bg-background shadow-lg"
    >
      <div className="flex h-8 items-center gap-2 border-b border-border-subtle px-2.5 text-xs">
        <Music className="size-3.5 text-muted" aria-hidden />
        <span className="font-medium">Spotify</span>
        <span className="ml-auto flex items-center gap-1">
          {embed && (
            <button
              type="button"
              onClick={() => save(null)}
              title="Change playlist"
              aria-label="Change playlist"
              className="cursor-pointer rounded p-1 text-muted-2 hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden />
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={open ? 'Collapse player' : 'Expand player'}
            className="cursor-pointer rounded p-1 text-muted-2 hover:text-foreground"
          >
            {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronUp className="size-3.5" aria-hidden />}
          </button>
        </span>
      </div>

      {/* Kept mounted while collapsed so the music does not stop. */}
      {embed && (
        <iframe
          title="Spotify player"
          src={embed}
          width="100%"
          height={152}
          allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          loading="lazy"
          className={cn('block border-0', !open && 'hidden')}
        />
      )}

      {!embed && open && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            submit()
          }}
          className="flex flex-col gap-2 p-2.5"
        >
          <p className="text-xs text-muted">
            Paste a Spotify playlist, album or track link. Sign in to Spotify in this browser for full
            songs instead of previews.
          </p>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="https://open.spotify.com/playlist/…"
            aria-label="Spotify link"
            className={cn(
              'h-8 rounded-md border bg-background px-2 text-xs focus:outline-2 focus:outline-accent',
              bad ? 'border-bad' : 'border-border-strong',
            )}
          />
          {bad && <p className="text-xs text-bad">That doesn’t look like a Spotify link.</p>}
          <button
            type="submit"
            className="h-8 cursor-pointer rounded-md bg-accent text-xs font-medium text-accent-fg hover:opacity-90"
          >
            Play
          </button>
        </form>
      )}
    </aside>
  )
}
