const FIELDS = ["name", "company", "metro", "role", "phone"] as const;
type Lead = Record<(typeof FIELDS)[number], string>;

export async function POST(request: Request) {
  let body: Partial<Lead>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const lead = {} as Lead;
  for (const f of FIELDS) {
    const v = typeof body[f] === "string" ? body[f]!.trim() : "";
    if (!v || v.length > 200) {
      return Response.json({ error: `Missing ${f}` }, { status: 400 });
    }
    lead[f] = v;
  }

  const payload = { ...lead, receivedAt: new Date().toISOString() };

  // Forward to whatever catches leads (Zapier, Make, Slack, your CRM).
  const webhook = process.env.LEAD_WEBHOOK_URL;
  if (webhook) {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("Lead webhook failed", res.status, payload);
      return Response.json({ error: "Could not deliver" }, { status: 502 });
    }
  } else {
    console.log("LEAD (no LEAD_WEBHOOK_URL set)", payload);
  }

  return Response.json({ ok: true });
}
