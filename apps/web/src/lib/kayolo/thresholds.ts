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
/** The hour's hops spread out: ≤ 10 in any 30 min, so a fast half hour can't spend them at once (§9.11, §12.23). */
export const T2_PER_HALF_HOUR = 10;
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

/* ---------------- Э4: the whole chain (§2.4, §8.2, §8.3) ---------------- */
/** Ergo aims at 2 min; the stream's own average (fees.histogram eta) replaces it. */
export const AVG_BLOCK_MS = 120_000;
/** E5 at 2× the average, E6 at 3×, E7 at 8 min — counted from when this browser got the block. */
export const WAIT1_X = 2;
export const WAIT2_X = 3;
export const STALL_MS = 8 * 60_000;
/** E4: the height went up by this much at once. Counting glances stop at 3. */
export const CATCHUP_MIN = 2;
export const COUNT_MAX = 3;
/** E12: right after a seal the pool fell to ≤ 0.4 of what waited (≥ 100). */
export const DRAIN_MS = 3_000;
export const DRAIN_RATIO = 0.4;
export const DRAIN_MIN = 100;
/** E10: once in 3 min; on /mempool a category under 2 % of this session's txs (≥ 50 seen). */
export const TOPIC_GAP_MS = 3 * 60_000;
export const TOPIC_RARE = 0.02;
export const TOPIC_MIN_SEEN = 50;
/** E11: ≥ max(200, 2 × the median per-minute count of 30 min), two snapshots ≥ 2 s apart. */
export const SURGE_FLOOR = 200;
export const SURGE_X = 2;
export const SURGE_WINDOW_MIN = 30;
export const SURGE_CALM_X = 1.3;
export const SURGE_CALM_MS = 2 * 60_000;
export const SURGE_GAP_MS = 10 * 60_000;
/** After a reconnect the first snapshots are not a surge or a drain. */
export const RECONNECT_QUIET_MS = 10_000;
/** Two readings of the same sensor count as two only this far apart (a snapshot comes twice in a seal). */
export const TWICE_MS = 2_000;
/** E13: p50 ≥ 3 × its hour's median (≥ 10 min of minutes), twice; calm at ≤ 1.5 × for 5 min; once in 30 min. */
export const FEE_X = 3;
export const FEE_WINDOW_MIN = 60;
export const FEE_WARM_MIN = 10;
export const FEE_CALM_X = 1.5;
export const FEE_CALM_MS = 5 * 60_000;
/** E13 judges p50 only with this many txs waiting (a pool of 6 swings 600×, §12.23). */
export const FEE_MIN_POOL = 20;
export const FEE_GAP_MS = 30 * 60_000;
/** E14: ≥ 1 % since the last poll, or ≥ 2.5 % from the low or high of the last 10 polls; once in 15 min. */
export const PRICE_STEP = 0.01;
export const PRICE_SWING = 0.025;
export const PRICE_POLLS = 10;
export const PRICE_GAP_MS = 15 * 60_000;
/** E15: once in 2 min; the act waits ≤ 15 s for the page to show the new price. */
export const ORACLE_GAP_MS = 2 * 60_000;
export const PAGE_DATA_MS = 15_000;
/** E16/E17: down this long is «связь пропала»; after 2 min he stops waiting (a proxy may cut WS for good). */
export const DOWN_MS = 6_000;
export const LOST_MS = 2 * 60_000;
/** Down this long is a rejoin with a hop, shorter a nod. */
export const REJOIN_MS = 30_000;
/** More than this many cycles in 2 min is a flapping feed: a nod, nothing more. */
export const FLAP_CYCLES = 3;
export const FLAP_WINDOW_MS = 2 * 60_000;
/** After the feed is back, the tip that follows tells how far it moved; no tip this long — k 0. */
export const REJOIN_WAIT_MS = 1_500;
/** «Связь пропала» dozes after a minute (§2.4). */
export const DOWN_DOZE_MS = 60_000;
/** E19: index lag above 5 on two polls; ≤ 2 clears it. Node headers ahead by ≥ 3 for over 30 s. */
export const BEHIND_LAG = 5;
export const BEHIND_CLEAR = 2;
export const NODE_BEHIND = 3;
export const NODE_BEHIND_MS = 30_000;
/** E19: a knock at the indicator every 60–90 s while it is on screen, ≤ 3 per visit. */
export const BEHIND_KNOCK_MIN_MS = 60_000;
export const BEHIND_KNOCK_MAX_MS = 90_000;
export const BEHIND_KNOCKS = 3;
/** E21: an epoch is 1024 blocks. */
export const EPOCH_LEN = 1024;
/** A background's think sway (and its darting eyes) runs this long, then the face holds still. */
export const BACK_WOBBLE_MS = 2_000;
/** A page:* about a height takes the block's own reaction this long after it (§2.8). */
export const HOLD_MS = 5_000;
/** TTLs (§8.3). */
export const TTL_E4 = 8_000;
export const TTL_TX_CONFIRMED = 45_000;
export const TTL_PAGE = 20_000;
export const TTL_E10 = 6_000;
export const TTL_E11 = 30_000;
export const TTL_E13 = 30_000;
export const TTL_E14 = 20_000;
export const TTL_E17 = 4_000;
/** page:addr-pending: a gesture once in 30 s per address. */
export const PENDING_GAP_MS = 30_000;
/** E23: «later» gets a glance only when the rent is ≤ 90 days off (720 blocks a day). */
export const RENT_LATER_BLOCKS = 90 * 720;
/** /tx in the mempool: a look at the «mempool» field ≤ 3 per visit, never from A2 on. */
export const POOL_LOOKS = 3;
/** Confirmations get a nod up to this many (§6.4); /block also at 720 (the reward matured). */
export const CONF_NODS = 10;
export const CONF_REWARD = 720;
/** A re-read after a seal: the pauses 1–2–3–4–5 s (≤ 15 s) until the index shows the block. */
export const REREAD_PAUSES_MS = [1_000, 2_000, 3_000, 4_000, 5_000] as const;
/** Each pause gets 0–400 ms more: tabs on one stream never ask the gateway in step. */
export const REREAD_JITTER_MS = 400;
/** A single re-read (an oracle tx the pool could not name): 3 s, when the index usually has the block. */
export const ONCE_REREAD_MS = 3_000;
/** One re-read after a pending tx left the pool without a seal that carried it (§12.23). */
export const GONE_REREAD_MS = 1_000;
/** /address rent: a seal with rent spends re-reads the due line at most this often (only while «now» shows). */
export const RENT_REREAD_GAP_MS = 60_000;
/** The layer's waiting rooms (held blocks, reactions deferred while the scout has the body): ≤ 3 each, oldest out. */
export const QUEUE_MAX = 3;
/** Heights whose block ids chain-sense keeps to see a fork (the gateway keeps 16). */
export const BLOCK_IDS_KEPT = 16;
