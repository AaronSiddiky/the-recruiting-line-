import type { Metadata } from "next";
import LeadsBrowser from "./LeadsBrowser";

export const metadata: Metadata = {
  title: "Lead List | The Recruiting Line",
  description: "Internal tool — load a Data Axle CSV export and browse target companies.",
  robots: { index: false, follow: false },
};

export default function LeadsPage() {
  return <LeadsBrowser />;
}
