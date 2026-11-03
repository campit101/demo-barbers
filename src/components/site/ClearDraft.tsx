"use client";

import { useEffect } from "react";
import { clearDraft } from "./draft";

/** On the confirmation page: the booking is made, so what was typed has done its job. */
export function ClearDraft() {
  useEffect(clearDraft, []);
  return null;
}
