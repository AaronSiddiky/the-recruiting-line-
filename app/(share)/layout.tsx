import type { Metadata } from 'next'

export const metadata: Metadata = {
  metadataBase: new URL('https://www.therecruitingline.com'),
  robots: { index: false, follow: false },
}

/** Bare root layout for public share pages (no sign-in, no app chrome). */
export default function ShareLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: '#0f1115', color: '#f5f5f5', fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif' }}>
        {children}
      </body>
    </html>
  )
}
