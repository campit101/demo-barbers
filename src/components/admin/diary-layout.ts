import { SHOP } from "@/config/shop";
import type { DiaryEntry } from "@/admin/views";

export const PX_PER_MINUTE = 2.2;
const MIN_TAP = 44;

export interface PlacedEntry {
  entry: DiaryEntry;
  top: number;
  height: number;
  /** Side-by-side position, for the rare short block whose 44 px tap target would run into the next entry. */
  lane: number;
  lanes: number;
}

/** Positions one barber's entries. A 20 minute booking is 44 px tall; nothing in a column ever covers anything else. */
export function placeEntries(entries: DiaryEntry[]): PlacedEntry[] {
  const placed: PlacedEntry[] = [...entries]
    .sort((a, b) => a.startMinute - b.startMinute)
    .map((entry) => ({
      entry,
      top: Math.round((entry.startMinute - SHOP.openMinute) * PX_PER_MINUTE),
      height: Math.max(Math.round((entry.endMinute - entry.startMinute) * PX_PER_MINUTE) - 2, MIN_TAP),
      lane: 0,
      lanes: 1,
    }));

  let cluster: PlacedEntry[] = [];
  let laneEnds: number[] = [];
  const flush = () => {
    for (const p of cluster) p.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  };
  for (const p of placed) {
    if (cluster.length && laneEnds.every((end) => end <= p.top)) flush();
    const free = laneEnds.findIndex((end) => end <= p.top);
    p.lane = free === -1 ? laneEnds.length : free;
    laneEnds[p.lane] = p.top + p.height;
    cluster.push(p);
  }
  flush();
  return placed;
}

export type StatusMark = "completed" | "noshow" | "refund" | "paying";

/** Which shape an entry carries beside its name. A plain booking and a block need none: blocks say "Blocked" and are striped. */
export function statusMark(e: DiaryEntry): StatusMark | null {
  if (e.kind === "block") return null;
  if (e.statusText.toLowerCase().includes("refund")) return "refund";
  if (e.status === "held") return "paying";
  if (e.status === "completed") return "completed";
  if (e.status === "no_show") return "noshow";
  return null;
}

export function entryClass(e: DiaryEntry, selected: boolean): string {
  const state = e.kind === "block" ? "block" : e.statusText.toLowerCase().includes("refund") || e.status === "completed" ? "completed" : e.status === "no_show" ? "noshow" : "";
  return ["bk", state, selected ? "sel" : ""].filter(Boolean).join(" ");
}
