"use client";

import { useEffect, useState } from "react";
import styles from "../page.module.css";

const LINKS = [
  { href: "#sourcing", label: "Sourcing" },
  { href: "#screening", label: "Screening" },
  { href: "#offer", label: "Terms" },
  { href: "#how", label: "How it runs" },
];

export default function Nav() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const mq = window.matchMedia("(min-width: 861px)");
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", close);
    };
  }, [open]);

  return (
    <nav className={styles.nav}>
      <a href="#top" className={styles.wordmark}>
        <span>recruitingline</span>
      </a>
      <div className={styles.navLinks}>
        {LINKS.map((l) => (
          <a key={l.href} href={l.href} className={styles.navLink}>
            {l.label}
          </a>
        ))}
      </div>
      <div className={styles.navRight}>
        <a href="mailto:contact@therecruitingline.com" className={`${styles.navLink} ${styles.navLogin}`}>
          Login
        </a>
        <a href="#start" className={styles.navCta}>
          Start a search →
        </a>
        <button
          type="button"
          className={`${styles.menuButton} ${open ? styles.menuOpen : ""}`}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          aria-controls="mobile-menu"
          onClick={() => setOpen((o) => !o)}
        >
          <span className={styles.menuIcon} />
        </button>
      </div>
      {open && (
        <div id="mobile-menu" className={styles.mobileMenu}>
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} onClick={() => setOpen(false)}>
              {l.label}
            </a>
          ))}
          <a href="mailto:contact@therecruitingline.com" onClick={() => setOpen(false)}>
            Login
          </a>
          <a href="#start" className={styles.mobileMenuCta} onClick={() => setOpen(false)}>
            Start a search →
          </a>
        </div>
      )}
    </nav>
  );
}
