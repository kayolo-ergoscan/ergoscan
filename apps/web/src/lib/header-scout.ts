/** One pass across the toolbar. Home never runs this. Address is his perch. */

import { rentTapeClock } from "@ergoscan/shared";

export function isAddressHome(path: string): boolean {
  return path === "/addresses" || path.startsWith("/address/");
}

/** Detail card only. The catalog stays the door. */
export function addressIdOf(path: string): string | null {
  if (!path.startsWith("/address/")) return null;
  const id = path.slice("/address/".length).split("/")[0];
  if (!id) return null;
  try {
    return decodeURIComponent(id);
  } catch {
    return id;
  }
}

const RU_CLOCK = { m: "мин", h: "ч", d: "д" } as const;

/** Three scratches. The clock matches the home rent tape: due, minutes, hours, or days. */
export function rentScratch(
  blocksUntilRent: number,
  labels: { danger: string; what: string; due: string },
  locale: "en" | "ru"
): { due: boolean; lines: [string, string, string] } {
  const clock = rentTapeClock(blocksUntilRent);
  const when = clock.due ? labels.due : locale === "ru" ? `${clock.n}${RU_CLOCK[clock.unit]}` : clock.label;
  return { due: clock.due, lines: [labels.danger, labels.what, when] };
}

/**
 * Click sends him home. He lines up before the search, ducks, then slips under
 * the word. He only drives through when the park sits past the letters and
 * still short of the title.
 */
export function addressReturnGate(box: {
  searchLeft: number;
  wordLeft: number;
  wordRight: number;
  reservedPark: number;
  titleLeft: number;
}): { approachX: number; parkX: number; slips: boolean } {
  const approachX = Math.min(box.searchLeft, box.wordLeft) - 32;
  const pastWord = box.wordRight + 48;
  const beforeTitle = box.titleLeft - 40;
  const parkX = Math.min(Math.max(box.reservedPark, pastWord), beforeTitle);
  const slips = approachX <= box.wordLeft - 24 && parkX >= pastWord - 0.5 && parkX > approachX + 16;
  return { approachX, parkX, slips };
}

export const SCOUT_CUES_EN = ["scan", "block", "transactions", "addresses", "tokens", "hash", "id"];
export const SCOUT_CUES_RU = ["скан", "блок", "транзакции", "адреса", "токены", "хэш", "id"];

export type ScoutBeat =
  | "fall"
  | "squat-title"
  | "under-title"
  | "rise-title"
  | "read"
  | "to-price"
  | "squat-price"
  | "under-price"
  | "rise-gap"
  | "price"
  | "squat-mcap"
  | "under-mcap"
  | "rise-mcap"
  | "mcap"
  | "squat-mcap-back"
  | "under-mcap-back"
  | "rise-gap-back"
  | "peek"
  | "squat-price-back"
  | "under-price-back"
  | "rise-price-back"
  | "to-title-back"
  | "squat-title-back"
  | "under-title-back"
  | "rise-title-back"
  | "to-search"
  | "seek"
  /** Kayolo's niche (Э1b, §7.1): the desktop tour starts and ends at home, right of the title. */
  | "to-home"
  | "home";

/**
 * Out: slip under the title and draw the line, slip under the price and
 * perform in the gap, slip under the market cap and perform after it.
 * Back: the same slips, without repeating the performances.
 * Phone has no title and no market cap.
 */
/** The usual toolbar pass, without the drop. He is already on the header floor. */
export function tourAfterReturn(hasTitle: boolean, hasMcap: boolean): ScoutBeat[] {
  return scoutBeats(hasTitle, hasMcap).slice(1);
}

/** Under a word he finishes the slip before he can stop and ask. */
export function askWaitsForSlip(beat: string): boolean {
  return beat.startsWith("under");
}

/**
 * `nook`: the desktop tour with Kayolo's window (design/brand/kayolo-life.md §7.1). After the price
 * he walks to his niche right of the title instead of going back under the title to the search.
 */
export function scoutBeats(hasTitle: boolean, hasMcap: boolean, nook = false): ScoutBeat[] {
  const beats: ScoutBeat[] = ["fall"];
  if (hasTitle) beats.push("squat-title", "under-title", "rise-title", "read");
  beats.push("to-price", "squat-price", "under-price", "rise-gap", "price");
  if (hasMcap) {
    beats.push(
      "squat-mcap",
      "under-mcap",
      "rise-mcap",
      "mcap",
      "squat-mcap-back",
      "under-mcap-back",
      "rise-gap-back",
      "peek"
    );
  }
  beats.push("squat-price-back", "under-price-back", "rise-price-back");
  if (nook) {
    beats.push("to-home", "home");
    return beats;
  }
  if (hasTitle) {
    beats.push("to-title-back", "squat-title-back", "under-title-back", "rise-title-back");
  }
  beats.push("to-search", "seek");
  return beats;
}
