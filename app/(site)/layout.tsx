import type { Metadata, Viewport } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";

// Variable font: one file covers every weight the page uses (400–600).
const instrumentSans = Instrument_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-instrument-sans",
});

const title = "The Recruiting Line | A Vetted HVAC Tech On Your Truck In 7 Days";
const description =
  "HVAC tech recruiting for home services operators. Vetted candidates in 7 days, a 30-day replacement guarantee, and no invoice until the hire completes 30 days.";

export const metadata: Metadata = {
  metadataBase: new URL("https://www.therecruitingline.com"),
  title,
  description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "The Recruiting Line",
    title,
    description,
    images: [{ url: "/hero/poster.jpg", width: 1280, height: 720 }],
  },
  twitter: { card: "summary_large_image", title, description, images: ["/hero/poster.jpg"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#15110d",
  colorScheme: "light",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={instrumentSans.variable}>
      <body>{children}</body>
    </html>
  );
}
