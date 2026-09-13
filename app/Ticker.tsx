"use client";

import { useEffect, useState } from "react";

const BASE = 7500;
const PER_SECOND = 1000 / (24 * 60 * 60); // $1,000 per open-seat day
const SPEEDUP = 60; // accelerated 60x so movement is visible

export default function Ticker() {
  const [value, setValue] = useState(BASE);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const start = Date.now();
    const id = setInterval(() => {
      const extra = ((Date.now() - start) / 1000) * PER_SECOND * SPEEDUP;
      setValue(BASE + extra);
    }, 250);
    return () => clearInterval(id);
  }, []);

  return <>{"$" + Math.floor(value).toLocaleString("en-US")}</>;
}
