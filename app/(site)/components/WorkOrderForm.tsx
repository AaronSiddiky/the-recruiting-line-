"use client";

import { useState } from "react";
import styles from "../page.module.css";

type Status = "idle" | "sending" | "sent" | "error";

export default function WorkOrderForm() {
  const [status, setStatus] = useState<Status>("idle");

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
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
      <div className={styles.form} role="status">
        <div className={styles.formHead}>
          <span>Work order: new seat</span>
          <span>Received</span>
        </div>
        <div className={styles.formDone}>
          <div className={styles.formDoneTitle}>Work order opened.</div>
          <p className={styles.formDoneBody}>We&apos;ll call within one business hour to brief the seat.</p>
        </div>
      </div>
    );
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <div className={styles.formHead}>
        <span>Work order: new seat</span>
        <span>15-minute brief follows</span>
      </div>
      <input className={styles.input} name="name" placeholder="Your name" aria-label="Your name" autoComplete="name" maxLength={200} required />
      <input className={styles.input} name="company" placeholder="Company" aria-label="Company" autoComplete="organization" maxLength={200} required />
      <div className={styles.inputPair}>
        <input className={styles.input} name="metro" placeholder="Metro" aria-label="Metro" maxLength={200} required />
        <input className={styles.input} name="role" placeholder="Role to fill" aria-label="Role to fill" maxLength={200} required />
      </div>
      <input className={styles.input} name="phone" type="tel" inputMode="tel" placeholder="Best number to reach you" aria-label="Best number to reach you" autoComplete="tel" maxLength={200} required />
      <button type="submit" className={styles.submit} disabled={status === "sending"}>
        {status === "sending" ? "Opening…" : "Open the work order"}
      </button>
      <div className={styles.formNote} role={status === "error" ? "alert" : undefined}>
        {status === "error"
          ? "Something broke on our end. Email us instead."
          : "No retainer. No invoice until day 30."}
      </div>
    </form>
  );
}
