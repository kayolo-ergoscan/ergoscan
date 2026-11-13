/**
 * Kayolo's scheduler (design/brand/kayolo-life.md §2.2, §2.8, §9.3). Pure: no DOM, no clock of its
 * own (every call takes `t`, ms), so tests drive it with a fake clock.
 *
 * - Alertness A0–A4 from the last input: 8 / 30 / 90 / 180 s.
 * - An offer carries a ladder of steps, loudest first (T3 bigBlock → T2 hop → T1 nod → T0 glance).
 *   The budget walks it down; nothing fits → dropped, never queued.
 * - Spontaneous offers (P3–P5) wait in a 400 ms merge window: the lowest P wins, then the loudest
 *   tier, then the freshest; the rest are absorbed. One pending offer with a TTL; while the person
 *   is busy it waits, and after 3 s of waiting it comes one tier lower.
 * - P1/P2 (a poke, a hover) go at once, are never cut by the budget, count in the attention window,
 *   and keep spontaneous T2+ away for 10 s. P1 interrupts a running act; anything else offered
 *   during an act is dropped.
 * - Budgets: T1 bucket of 3 (+1 per 15 s, 6 s apart); T2 ≥ 20 s apart, ≤ 3 per 2 min, ≤ 20 per hour;
 *   T3 ≥ 120 s apart, ≤ 8 per hour; eye reactions ≥ 1.2 s apart; attention (non-eye) ≤ 18 s per
 *   5 min and ≤ 6 s per 60 s.
 */

import {
  A1_MS,
  A2_MS,
  A3_MS,
  A4_MS,
  AFTER_HUMAN_MS,
  ATTN_5MIN_MS,
  ATTN_60S_MS,
  EYE_GAP_MS,
  MERGE_MS,
  PENDING_DEMOTE_MS,
  T1_GAP_MS,
  T1_REFILL_MS,
  T1_TOKENS,
  T2_GAP_MS,
  T2_PER_2MIN,
  T2_PER_HOUR,
  T3_GAP_MS,
  T3_PER_HOUR,
} from "./thresholds";

export type Tier = 0 | 1 | 2 | 3;
export type Prio = 1 | 2 | 3 | 4 | 5;
export type Level = 0 | 1 | 2 | 3 | 4;
export type SchedMode = "live" | "calm" | "asleep" | "hidden" | "off";

export type Step = { tier: Tier; act: string; ms: number };

export type Offer = {
  key: string;
  prio: Prio;
  ttlMs: number;
  /** Loudest first. */
  ladder: Step[];
  /** Wakes him from A4 first (a big block, a rare height). */
  wakes?: boolean;
  /** What A4 does instead of a P5 offer (a stir in his sleep). */
  stir?: Step;
};

export type Play = { key: string; prio: Prio; step: Step; wake: boolean };

type Waiting = Offer & { at: number };

const LEVELS = [A1_MS, A2_MS, A3_MS, A4_MS];

export function levelAt(sinceInputMs: number): Level {
  let l = 0;
  for (const edge of LEVELS) if (sinceInputMs >= edge) l += 1;
  return l as Level;
}

export function createScheduler(t0 = 0) {
  let lastInput = t0;
  let busyUntil = -Infinity;
  let mode: SchedMode = "live";
  let running: { until: number; prio: Prio } | null = null;
  let inbox: Waiting[] = [];
  let windowEnd = -Infinity;
  let pending: Waiting | null = null;
  let tokens = T1_TOKENS;
  let tokenAt = t0;
  let lastT1 = -Infinity;
  let lastEye = -Infinity;
  let lastHuman = -Infinity;
  const t2: number[] = [];
  const t3: number[] = [];
  const attn: { at: number; ms: number }[] = [];
  const log: string[] = [];

  const note = (t: number, s: string) => {
    log.push(`${Math.round(t)} ${s}`);
    if (log.length > 200) log.shift();
  };

  const refill = (t: number) => {
    if (tokens >= T1_TOKENS) {
      tokenAt = t;
      return;
    }
    const n = Math.floor((t - tokenAt) / T1_REFILL_MS);
    if (n > 0) {
      tokens = Math.min(T1_TOKENS, tokens + n);
      tokenAt += n * T1_REFILL_MS;
    }
  };

  const prune = (t: number) => {
    while (t2.length && t - t2[0] > 3_600_000) t2.shift();
    while (t3.length && t - t3[0] > 3_600_000) t3.shift();
    while (attn.length && t - attn[0].at > 300_000) attn.shift();
  };

  const attnFits = (t: number, ms: number) => {
    let five = 0;
    let sixty = 0;
    for (const a of attn) {
      five += a.ms;
      const end = a.at + a.ms;
      if (end > t - 60_000) sixty += Math.min(a.ms, end - (t - 60_000));
    }
    return five + ms <= ATTN_5MIN_MS && sixty + ms <= ATTN_60S_MS;
  };

  const fits = (step: Step, t: number) => {
    if (step.tier === 0) return t - lastEye >= EYE_GAP_MS;
    if (!attnFits(t, step.ms)) return false;
    if (step.tier === 1) return tokens >= 1 && t - lastT1 >= T1_GAP_MS;
    if (t - lastHuman < AFTER_HUMAN_MS) return false;
    if (step.tier === 2) {
      const last = t2[t2.length - 1] ?? -Infinity;
      return t - last >= T2_GAP_MS && t2.filter((x) => t - x < 120_000).length < T2_PER_2MIN && t2.length < T2_PER_HOUR;
    }
    const last = t3[t3.length - 1] ?? -Infinity;
    return t - last >= T3_GAP_MS && t3.length < T3_PER_HOUR;
  };

  const spend = (step: Step, t: number, human: boolean) => {
    if (step.tier >= 1) attn.push({ at: t, ms: step.ms });
    if (human) {
      lastHuman = t;
      return;
    }
    if (step.tier === 0) lastEye = t;
    else if (step.tier === 1) {
      tokens -= 1;
      lastT1 = t;
    } else if (step.tier === 2) t2.push(t);
    else t3.push(t);
  };

  /** Lower is better: prio, then a louder first step, then fresher. */
  const better = (a: Waiting, b: Waiting) =>
    a.prio !== b.prio ? a.prio < b.prio : (a.ladder[0]?.tier ?? 0) !== (b.ladder[0]?.tier ?? 0) ? (a.ladder[0]?.tier ?? 0) > (b.ladder[0]?.tier ?? 0) : a.at >= b.at;

  const level = (t: number) => levelAt(t - lastInput);

  const playing = (t: number) => running != null && t < running.until;

  const start = (o: Waiting, step: Step, t: number, wake: boolean): Play => {
    const human = o.prio <= 2;
    spend(step, t, human);
    running = { until: t + step.ms, prio: o.prio };
    note(t, `play ${o.key} ${step.act} T${step.tier}${wake ? " +wake" : ""}`);
    return { key: o.key, prio: o.prio, step, wake };
  };

  return {
    log,
    mode(m: SchedMode) {
      mode = m;
      if (m !== "live" && m !== "calm") {
        inbox = [];
        pending = null;
      }
    },
    /** Input from the person. Returns the level he was at (A2+ means a wake-up is due). */
    input(t: number): Level {
      const was = level(t);
      lastInput = t;
      return was;
    },
    /** As if the last input was this long ago (a tab shown again keeps its level). */
    inputAt(t: number) {
      lastInput = t;
    },
    level,
    /** Seconds of rest that put him at this level now (for the frozen-frame clock). */
    sinceInput(t: number) {
      return t - lastInput;
    },
    busy(until: number) {
      busyUntil = Math.max(busyUntil, until);
    },
    offer(o: Offer, t: number) {
      if (mode !== "live" && mode !== "calm") return;
      if (!o.ladder.length) return;
      inbox.push({ ...o, at: t });
      if (o.prio >= 3 && windowEnd < t) windowEnd = t + MERGE_MS;
      note(t, `offer ${o.key} P${o.prio}`);
    },
    /** The act to start now, if any. */
    next(t: number): Play | null {
      if (mode !== "live" && mode !== "calm") return null;
      prune(t);
      refill(t);
      // A person's action goes at once.
      const human = inbox.filter((o) => o.prio <= 2);
      if (human.length) {
        inbox = inbox.filter((o) => o.prio > 2);
        const o = human.reduce((a, b) => (better(b, a) ? b : a));
        if (playing(t) && running && running.prio <= o.prio && o.prio !== 1) return null;
        return start(o, o.ladder[0], t, false);
      }
      if (inbox.length && t < windowEnd) return null;
      if (inbox.length) {
        let win = inbox[0];
        for (const o of inbox.slice(1)) if (better(o, win)) win = o;
        for (const o of inbox) if (o !== win) note(t, `absorbed ${o.key}`);
        inbox = [];
        if (!pending || better(win, pending)) pending = win;
      }
      const o = pending;
      if (!o) return null;
      if (t - o.at > o.ttlMs) {
        pending = null;
        note(t, `ttl ${o.key}`);
        return null;
      }
      if (playing(t)) {
        pending = null;
        note(t, `dropped ${o.key} (act running)`);
        return null;
      }
      if (t < busyUntil) return null;
      // Ladder start: waiting and alertness bring him down.
      let from = 0;
      const lv = level(t);
      if (t - o.at > PENDING_DEMOTE_MS) from += 1;
      if (lv === 2 && o.prio >= 4) from += 1;
      let ladder = o.ladder;
      let wake = false;
      if (lv === 3 && o.prio === 5) ladder = ladder.filter((s) => s.tier === 0);
      if (lv === 4) {
        if (o.wakes) wake = true;
        else if (o.prio === 5) ladder = o.stir ? [o.stir] : [];
      }
      pending = null;
      for (const step of ladder.slice(Math.min(from, Math.max(0, ladder.length - 1)))) {
        if (fits(step, t)) return start(o, step, t, wake);
      }
      note(t, `no budget ${o.key}`);
      return null;
    },
    /** The running act ended early (interrupted, or the body went away). */
    done() {
      running = null;
    },
    /** When something may change on its own: a level edge, the merge window, a waiting offer. */
    nextDue(t: number): number {
      let due = Infinity;
      const since = t - lastInput;
      for (const edge of LEVELS) if (since < edge) due = Math.min(due, lastInput + edge);
      if (inbox.length) due = Math.min(due, Math.max(t, windowEnd));
      if (pending) {
        due = Math.min(due, pending.at + pending.ttlMs);
        if (t < busyUntil) due = Math.min(due, busyUntil);
        else due = Math.min(due, t);
      }
      if (running && t < running.until) due = Math.min(due, running.until);
      return due;
    },
  };
}

export type Scheduler = ReturnType<typeof createScheduler>;
