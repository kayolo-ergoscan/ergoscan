/**
 * Kayolo's numbers in one place (design/brand/kayolo-life.md §2, §8, §9.9). The two switches roll a
 * stage back in one commit; they are not hidden flags.
 */

/** Reactions to the chain (E1–E3). */
export const KAYOLO_CHAIN = true;
/** His window, the layer and the hand-over. False gives the header back to HeaderScout as in Э1a. */
export const KAYOLO_LAYER = true;

/** A block with this many transactions or more is big (also Kayolo's surprise on the home city, lib/home-city/city.ts). */
export const BUSY_TX = 39;

/** Body scale in the header (HeaderScout SCALE): a 22.4 px square. */
export const BODY_SCALE = 0.86;
/** Phone hops: ×0.8 and never above 6 px (§2.7). */
export const PHONE_HOP = { hopScale: 0.8, hopMax: 6 } as const;

/* Alertness (§2.2): time without input. */
export const A1_MS = 8_000;
export const A2_MS = 30_000;
export const A3_MS = 90_000;
export const A4_MS = 180_000;
/** Asleep: this long of breathing and drifting squares at 12 fps, then the frozen frame. */
export const ZZZ_MS = 30_000;
export const ZZZ_FPS = 12;
/** Back from a hidden tab after this long: awake again, with the wake-up. */
export const AWAY_WAKE_MS = 60_000;
/** Pointer moves shorter than this are not input. */
export const MOVE_MIN_PX = 4;

/* Eyes (§2.6). */
export const GAZE_RADIUS = 240;
export const GAZE_FPS = 20;
/** Reading and dozing (A2–A3) at rest: at most this many frames a second (§9.10: ≤ 300 a minute). */
export const REST_FPS = 20;
export const GAZE_JUMP_PX = 24;
export const SHY_PX = 48;

/* The tour (§7.1, §12.2). */
export const TOUR_GAP_MS = 10 * 60_000;

/* Scheduler budgets (§2.8). */
export const MERGE_MS = 400;
export const T1_TOKENS = 3;
export const T1_REFILL_MS = 15_000;
export const T1_GAP_MS = 6_000;
export const T2_GAP_MS = 20_000;
export const T2_PER_2MIN = 3;
export const T2_PER_HOUR = 20;
export const T3_GAP_MS = 120_000;
export const T3_PER_HOUR = 8;
export const ATTN_5MIN_MS = 18_000;
export const ATTN_60S_MS = 6_000;
export const AFTER_HUMAN_MS = 10_000;
export const EYE_GAP_MS = 1_200;
export const PENDING_DEMOTE_MS = 3_000;

/* Busy windows (§2.8). */
export const SCROLL_BUSY_MS = 600;
export const TYPE_BUSY_MS = 800;
export const PRESS_BUSY_MS = 350;
export const NAV_BUSY_MS = 800;

/* Pokes (§4.2) and hover (§4.1). */
export const POKE_CHAIN_MS = 900;
export const POKE_RESET_MS = 2_500;
export const POKE_NEXT_AT = 0.6;
export const NOTICE_MS = 250;
export const TIP_MS = 600;

/* Block events (§8.3): how long an offer may wait. */
export const TTL_E1 = 8_000;
export const TTL_E2 = 8_000;
export const TTL_E3 = 12_000;
export const TTL_RARE = 60_000;
/** No block.sealed this long after chain.tip: the tip alone stands for the block. */
export const SEAL_WAIT_MS = 3_000;
/** Live feed lost this long: the status line says so (§4.8). */
export const OFFLINE_MS = 6_000;

/* The niche (§3.1): body centre = right edge of the title + 14 + 11. */
export const NOOK_GAP = 14;
export const NOOK_HALF = 11;
/** A step to a new niche: 140 px/s. */
export const STEP_PX_S = 140;
