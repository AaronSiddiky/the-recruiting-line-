"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";

const CLIP_COUNT = 3;
const FADE_MS = 900;
const HERO_POSTER = "/hero/poster.webp";

// Self-hosted, faststart H.264 (see public/hero). Phones and small laptops get 720p.
function clipUrl(i: number) {
  const hd = window.matchMedia("(min-width: 1024px) and (min-resolution: 1.5dppx), (min-width: 1440px)").matches;
  return `/hero/clip${(i % CLIP_COUNT) + 1}-${hd ? 1080 : 720}.mp4`;
}

// React sets `muted` only as a property, which Chrome's autoplay policy
// ignores, so force the attribute before calling play().
function kick(el: HTMLVideoElement | null) {
  if (!el) return;
  el.muted = true;
  el.setAttribute("muted", "");
  el.setAttribute("playsinline", "");
  el.play()?.catch(() => {});
}

export default function HeroVideo() {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const clip = useRef(0);
  const switching = useRef(false);
  const visible = useRef(true);
  const enabled = useRef(false);
  const container = useRef<HTMLDivElement>(null);

  const els = () => [a.current, b.current];

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const [va, vb] = els();
    if (!va || !vb) return;

    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      enabled.current = true;
      va.src = clipUrl(0);
      kick(va);
      vb.src = clipUrl(1);
      vb.preload = "auto";
      vb.load();
    };
    // Let the page paint and hydrate first; the poster covers the gap.
    if (document.readyState === "complete") requestAnimationFrame(start);
    else window.addEventListener("load", start, { once: true });

    const sync = () => {
      const el = els()[activeRef.current];
      if (!el || !enabled.current) return;
      if (visible.current && !document.hidden) kick(el);
      else el.pause();
    };
    const io = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
      sync();
    });
    if (container.current) io.observe(container.current);
    document.addEventListener("visibilitychange", sync);

    return () => {
      window.removeEventListener("load", start);
      document.removeEventListener("visibilitychange", sync);
      io.disconnect();
    };
  }, []);

  const onTimeUpdate = (idx: number) => (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    if (idx !== activeRef.current || !el.duration || switching.current) return;
    if (el.duration - el.currentTime < FADE_MS / 1000) {
      switching.current = true;
      const nextIdx = 1 - idx;
      clip.current = (clip.current + 1) % CLIP_COUNT;
      kick(els()[nextIdx]);
      activeRef.current = nextIdx;
      setActive(nextIdx);
      setTimeout(() => {
        el.pause();
        el.src = clipUrl(clip.current + 1);
        el.load();
        switching.current = false;
      }, FADE_MS);
    }
  };

  return (
    <div ref={container} className={styles.heroMedia} aria-hidden="true">
      {[0, 1].map((i) => (
        <video
          key={i}
          ref={i === 0 ? a : b}
          className={styles.video}
          style={{ opacity: active === i ? 1 : 0 }}
          poster={i === 0 ? HERO_POSTER : undefined}
          muted
          playsInline
          preload="none"
          disablePictureInPicture
          disableRemotePlayback
          onTimeUpdate={onTimeUpdate(i)}
          onCanPlay={(e) => {
            if (enabled.current && visible.current && i === activeRef.current) kick(e.currentTarget);
          }}
          onPause={(e) => {
            // Low-power mode or a browser hiccup can pause us; resume while on screen.
            const el = e.currentTarget;
            const shouldPlay = () =>
              enabled.current && visible.current && !document.hidden && i === activeRef.current && !switching.current;
            if (shouldPlay()) setTimeout(() => shouldPlay() && el.paused && kick(el), 250);
          }}
        />
      ))}
    </div>
  );
}
