import type { Metadata } from "next";
import { Instrument_Sans } from "next/font/google";
import "./globals.css";

const instrumentSans = Instrument_Sans({
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
  variable: "--font-instrument-sans",
});

export const metadata: Metadata = {
  title: "The Recruiting Line | A Vetted HVAC Tech On Your Truck In 7 Days",
  description:
    "HVAC tech recruiting for home services operators. Vetted candidates in 7 days, a 30-day replacement guarantee, and no invoice until the hire completes 30 days.",
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
