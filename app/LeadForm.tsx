"use client";

import { useState, type FormEvent } from "react";

type Status = "idle" | "sending" | "sent" | "error";

export default function LeadForm() {
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = Object.fromEntries(new FormData(form).entries());
    setStatus("sending");
    try {
      const res = await fetch("/api/lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error(String(res.status));
      setStatus("sent");
      form.reset();
    } catch {
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="lead-done" role="status">
        <span className="stamp stamp-in">Received</span>
        <h3>Work order opened.</h3>
        <p>We call you within one business hour to brief the seat.</p>
      </div>
    );
  }

  return (
    <form className="lead-form" onSubmit={onSubmit}>
      <div className="lf-head">
        <span className="t">Work order: new seat</span>
        <span className="n">15-minute brief follows</span>
      </div>
      <div className="lf-grid">
        <label>
          <span>Your name</span>
          <input name="name" required autoComplete="name" maxLength={200} />
        </label>
        <label>
          <span>Company</span>
          <input name="company" required autoComplete="organization" maxLength={200} />
        </label>
        <label>
          <span>Metro</span>
          <input name="metro" required placeholder="e.g. Phoenix, AZ" maxLength={200} />
        </label>
        <label>
          <span>Role to fill</span>
          <input name="role" required defaultValue="HVAC Service Tech" maxLength={200} />
        </label>
        <label className="wide">
          <span>Best number to reach you</span>
          <input name="phone" type="tel" required autoComplete="tel" inputMode="tel" maxLength={200} />
        </label>
      </div>
      <div className="lf-foot">
        <button className="btn btn-primary" type="submit" disabled={status === "sending"}>
          {status === "sending" ? "Opening…" : "Open the work order"}
        </button>
        <span className="lf-note">
          {status === "error"
            ? "Something broke on our end. Call or email instead."
            : "No retainer. No invoice until day 30."}
        </span>
      </div>
    </form>
  );
}
