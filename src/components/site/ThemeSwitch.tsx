"use client";

import { useSyncExternalStore } from "react";

type Theme = "auto" | "light" | "dark";
const NEXT: Record<Theme, Theme> = { auto: "light", light: "dark", dark: "auto" };
const LABEL: Record<Theme, string> = { auto: "Auto", light: "Light", dark: "Dark" };
const EVENT = "db-theme-change";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

const read = () => (document.documentElement.dataset.theme as Theme | undefined) ?? "auto";

export function ThemeSwitch() {
  const theme = useSyncExternalStore(subscribe, read, () => "auto" as Theme);
  return (
    <button
      type="button"
      className="lnk"
      aria-label={`Colour theme: ${LABEL[theme]}. Change`}
      onClick={() => {
        const next = NEXT[read()];
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("db-theme", next);
        } catch {
          // Storage blocked: the theme still applies for this page.
        }
        window.dispatchEvent(new Event(EVENT));
      }}
    >
      {LABEL[theme]}
    </button>
  );
}
