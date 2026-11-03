"use client";

import { useState } from "react";
import { Photo } from "./Photo";

const STAGES = [
  {
    name: "Choose",
    text: "Pick a service, one of two barbers and a time that fits. Times that would run past closing or into the next booking are never offered.",
    img: "/photos/scissors.jpg",
    alt: "A smiling barber at work with scissors. AI-generated.",
  },
  {
    name: "Hold",
    text: "Your time is held for 10 minutes while you pay the 20% deposit. Nobody else can take it, even if two people tap at the same moment.",
    img: "/photos/jar.jpg",
    alt: "The counter with a plain jar, scissors and folded towels. AI-generated.",
  },
  {
    name: "Confirm",
    text: "Once paid, you get a private link to save. A real shop would email it; this demo sends no emails, so it shows on screen.",
    img: "/photos/fade.jpg",
    alt: "A sharp skin fade from behind, with the client smiling in the mirror. AI-generated.",
  },
  {
    name: "Change",
    text: "Use the link to cancel or rebook. Free up to 24 hours before, with the deposit refunded. Later than that, the deposit is kept.",
    img: "/photos/bench.jpg",
    alt: "Two friends laughing on the waiting bench. AI-generated.",
  },
];

export function Stages() {
  const [open, setOpen] = useState(0);
  return (
    <div className="stages">
      {STAGES.map((s, i) => (
        <div key={s.name} className={`stage s${i + 1}${open === i ? " open" : ""}`}>
          <button type="button" className="stage-btn" aria-expanded={open === i} onClick={() => setOpen(i)}>
            <span>{s.name}</span>
          </button>
          {open === i && (
            <div className="stage-body">
              <p>{s.text}</p>
              <div className="stage-pic">
                <Photo src={s.img} alt={s.alt} sizes="(max-width: 720px) 100vw, (max-width: 1023px) 50vw, 30vw" />
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
