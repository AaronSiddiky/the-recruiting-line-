"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../page.module.css";

const CLIPS = [
  "https://videos.pexels.com/video-files/8986890/8986890-hd_1920_1080_30fps.mp4",
  "https://videos.pexels.com/video-files/8986886/8986886-hd_1920_1080_30fps.mp4",
  "https://videos.pexels.com/video-files/8986477/8986477-hd_1920_1080_30fps.mp4",
];
const FADE_MS = 900;

// React sets `muted` only as a property, which Chrome's autoplay policy
// ignores, so force the attribute and retry play() until it sticks.
function kick(el: HTMLVideoElement | null) {
  if (!el) return;
  el.muted = true;
  el.setAttribute("muted", "");
  el.setAttribute("playsinline", "");
  el.play()?.catch(() => {});
}

export default function HeroVideo() {
  const refs = [useRef<HTMLVideoElement>(null), useRef<HTMLVideoElement>(null)];
  const [active, setActive] = useState(0);
  const activeRef = useRef(0);
  const clip = useRef(0);
  const switching = useRef(false);
  const reducedMotion = useRef(false);

  useEffect(() => {
    const a = refs[0].current;
    const b = refs[1].current;
    reducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (a) {
      a.muted = true;
      a.setAttribute("muted", "");
      a.src = CLIPS[0];
      if (reducedMotion.current) a.load();
      else kick(a);
    }
    if (reducedMotion.current) return;

    if (b) {
      b.muted = true;
      b.setAttribute("muted", "");
      b.src = CLIPS[1 % CLIPS.length];
      b.load();
    }
    const t = setInterval(() => {
      const el = refs[activeRef.current].current;
      if (el && el.paused) kick(el);
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onTimeUpdate = (idx: number) => (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const el = e.currentTarget;
    if (reducedMotion.current || idx !== activeRef.current || !el.duration) return;
    if (el.duration - el.currentTime < FADE_MS / 1000 && !switching.current) {
      switching.current = true;
      const nextIdx = 1 - idx;
      clip.current = (clip.current + 1) % CLIPS.length;
      kick(refs[nextIdx].current);
      activeRef.current = nextIdx;
      setActive(nextIdx);
      setTimeout(() => {
        el.pause();
        el.src = CLIPS[(clip.current + 1) % CLIPS.length];
        el.load();
        switching.current = false;
      }, FADE_MS);
    }
  };

  return (
    <div className={styles.heroMedia} aria-hidden="true">
      {[0, 1].map((i) => (
        <video
          key={i}
          ref={refs[i]}
          className={styles.video}
          style={{ opacity: active === i ? 1 : 0 }}
          muted
          playsInline
          preload="auto"
          onTimeUpdate={onTimeUpdate(i)}
          onCanPlay={(e) => {
            if (!reducedMotion.current && i === activeRef.current) kick(e.currentTarget);
          }}
        />
      ))}
    </div>
  );
}
