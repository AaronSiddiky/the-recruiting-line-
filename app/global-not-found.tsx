import type { Metadata } from "next";
import Link from "next/link";
import { Instrument_Sans } from "next/font/google";

const instrumentSans = Instrument_Sans({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Page not found | The Recruiting Line",
  robots: { index: false, follow: false },
};

export default function GlobalNotFound() {
  return (
    <html lang="en" className={instrumentSans.className}>
      <body
        style={{
          margin: 0,
          minHeight: "100svh",
          display: "grid",
          placeItems: "center",
          background: "#fff",
          color: "#0f1420",
          WebkitFontSmoothing: "antialiased",
          padding: 24,
          textAlign: "center",
        }}
      >
        <main>
          <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 14px" }}>404</p>
          <h1 style={{ fontSize: "clamp(30px, 4vw, 52px)", lineHeight: 1.05, letterSpacing: "-.03em", fontWeight: 500, margin: "0 0 28px" }}>
            This page doesn&apos;t exist.
          </h1>
          <Link
            href="/"
            style={{ display: "inline-flex", padding: "14px 22px", borderRadius: 999, background: "#0f1420", color: "#fff", fontWeight: 600, fontSize: 15, textDecoration: "none" }}
          >
            Back to the homepage
          </Link>
        </main>
      </body>
    </html>
  );
}
