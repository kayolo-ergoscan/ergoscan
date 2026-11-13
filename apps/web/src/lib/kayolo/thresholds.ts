/**
 * Kayolo's numbers in one place (design/brand/kayolo-life.md §2, §8, §9.9). The two switches roll a
 * stage back in one commit; they are not hidden flags.
 */

/** Reactions to the chain (E1–E3). */
export const KAYOLO_CHAIN = true;
/** His window, the layer and the hand-over. False gives the header back to HeaderScout as in Э1a. */
export const KAYOLO_LAYER = true;

/** A block with this many transactions or more is big (CadenceYard.tsx BUSY_TX). */
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
/* Night, 23:00–05:59 local (§2.3): A2 from 15 s, A3 from 60 s, A4 from 120 s (frozen at 150 s). */
export const NIGHT_A2_MS = 15_000;
export const NIGHT_A3_MS = 60_000;
export const NIGHT_A4_MS = 120_000;
export const NIGHT_FROM_H = 23;
export const NIGHT_TO_H = 6;
/** Blinks at night come 1.3× rarer. */
export const NIGHT_BLINK_GAP = 1.3;
/** The morning stretch, once a day, on the first visit between 06:00 and 10:59. */
export const MORNING_FROM_H = 6;
export const MORNING_TO_H = 11;
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

/* Э3 answers (§6.2, §7). */
/** A route wait: think first, then he pushes the door (a knock every 700 ms). */
export const DOOR_AFTER_MS = 500;
export const DOOR_KNOCK_MS = 700;
/** Still waiting: a look at the person and a big shrug; later he sits down to wait. */
export const DOOR_SHRUG_MS = 4_000;
export const DOOR_SIT_MS = 8_000;
/** The arrival beat (a look at the page's key figure) comes this long after the arrival act. */
export const ARRIVE_BEAT_MS = 800;
/** A copy answers with a nod at most every 2 s, a heart every 3 s, a page step every 3 s; else eyes. */
export const COPY_GAP_MS = 2_000;
export const FAV_GAP_MS = 3_000;
export const PAGE_GAP_MS = 3_000;
/** Any other answer to the same kind of action: a gesture at most every 2 s, else the eyes (§2.8). */
export const ANSWER_GAP_MS = 2_000;
/** A hovered or focused thing that means something: looked at after 300 ms, held ≤ 1.2 s, ≥ 1.5 s apart. */
export const HOVER_MS = 300;
export const HOVER_HOLD_MS = 1_200;
export const HOVER_GAP_MS = 1_500;
/** Focus: at most every 400 ms. A tap on the phone: eyes on the point 1.5 s, ≥ 400 ms apart. */
export const FOCUS_GAP_MS = 400;
export const TAP_HOLD_MS = 1_500;
export const TAP_GAP_MS = 400;
/** The palette edge (§3.3): only from 1280 px wide; the jump there and back takes ≤ 400 ms. */
export const EDGE_MIN_W = 1280;
export const EDGE_JUMP_MS = 380;
/** Typing in the palette: the eyes follow the caret on a move ≥ 12 px or after a 150 ms pause. */
export const CARET_PX = 12;
export const CARET_PAUSE_MS = 150;
/** The recolour blink (§7.1): the colour changes while the eyes are shut. */
export const RECOLOR_MS = 240;
