"use client";

import { useSyncExternalStore } from "react";

type Theme = "auto" | "light" | "dark";

const LABEL: Record<Theme, string> = { auto: "Auto", light: "Light", dark: "Dark" };
const NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const listeners = new Set<() => void>();

function read(): Theme {
  const t = document.documentElement.getAttribute("data-theme");
  return t === "light" || t === "dark" ? t : "auto";
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribe, read, (): Theme => "auto");
  const cycle = () => {
    const next = NEXT[read()];
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem("db-theme", next);
    } catch {
      // Private windows can refuse storage. The switch still works until the page is closed.
    }
    listeners.forEach((l) => l());
  };
  return (
    <button type="button" className="ad-nav" onClick={cycle} aria-label={`Colour theme: ${LABEL[theme]}. Change`}>
      Theme: {LABEL[theme]}
    </button>
  );
}
