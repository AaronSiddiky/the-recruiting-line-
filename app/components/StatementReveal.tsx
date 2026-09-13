"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";

export default function StatementReveal({ text }: { text: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setRevealed(true);
          io.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <h2
      ref={ref}
      aria-label={text}
      className={`${styles.statementH2} ${revealed ? styles.revealed : ""}`}
    >
      {text.split(" ").map((word, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={styles.word}
          style={{ transitionDelay: `${i * 70}ms` }}
        >
          {word}
        </span>
      ))}
    </h2>
  );
}
