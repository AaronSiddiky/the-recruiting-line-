import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import "./leads.css";

const barlow = Barlow({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-barlow",
});

const barlowCondensed = Barlow_Condensed({
  weight: ["600", "700", "800"],
  subsets: ["latin"],
  variable: "--font-barlow-condensed",
});

const plexMono = IBM_Plex_Mono({
  weight: ["400", "500", "600"],
  subsets: ["latin"],
  variable: "--font-plex-mono",
});

export default function LeadsLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div
      className={`${barlow.variable} ${barlowCondensed.variable} ${plexMono.variable}`}
    >
      {children}
    </div>
  );
}
