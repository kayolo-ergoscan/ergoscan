/**
 * Rule order (first hit is the main action, later facts go to `secondary`):
 * 1. consensus: block reward, block fees, storage rent, 88… reward-lock payouts;
 * 2. protocols by SPENT contracts: oracle (rate update before price post), pools, banks, bridge,
 *    lending, names, auction, mixer, Lithos. Data inputs never name a protocol;
 * 3. payments INTO known contracts: order, bridge lock, name commit, lot, reserve;
 * 4. token issue (token id == any input id) and burn;
 * 5. wallet moves: send / multisend / self / consolidate;
 * 6. fallback: contract call / sent to contract.
 */
import { p2pkAddressFromCompressedPubkey } from "../oracle-pools.js";
import { chainLabel } from "../rosen-chains.js";
import { extractEventFromRegisters, parseCollCollByte } from "../rosen-event.js";
import {
  ERG,
  addInto,
  bagOf,
  minus,
  netOf,
  plus,
  sides,
  walletGainers,
  type AssetKey,
  type Bag,
  type FBox,
  type Facts,
} from "./facts.js";
import { PROTOCOL_NAMES, STABLE_TOKENS, oraclePairOf, type ContractRole, type ProtocolId, type RoleEntry } from "./registry.js";
import type { MeaningConf, MeaningCtx, WhyFact } from "./types.js";
import type { MeaningActionId } from "./vocab.js";

export type Amounts = Array<[AssetKey, bigint]>;

export type Draft = {
  action: MeaningActionId;
  protocol: ProtocolId | null;
  conf: MeaningConf;
  actor: string | null;
  counterparty?: string | null;
  count?: number;
  gave?: Amounts;
  got?: Amounts;
  venues?: string[];
  extra?: Array<{ to: string; key: AssetKey; amount: bigint; role?: string }>;
  secondary?: MeaningActionId[];
  why: WhyFact[];
  viaOrder?: boolean;
  chain?: string | null;
  /** Contract name for «вызвал «…»» and upkeep lines. */
  label?: string;
  /** Oracle pair, or pool pair for pool-create / LP moves. */
  pair?: string | null;
  /** Phrase variant inside one action (commit, request, borrow…). */
  sub?: string;
  /** Second number for the phrase (boxes out on a consolidation, blocks on a payout). */
  count2?: number;
  /** The one amount every receiver got, when all got the same (a split, a token handout). */
  each?: [AssetKey, bigint];
  /** The fee was paid by someone the phrase does not name (executor). */
  feeHidden?: boolean;
};

type Rule = (f: Facts, ctx: MeaningCtx) => Draft | null;

const ROLE_WHY = (b: FBox, k = "spent"): WhyFact => ({ k, v: b.role?.label ?? b.address });

/** Box order is not trusted: every pick below goes through a stable sort. */
function stable(boxes: FBox[]): FBox[] {
  const key = (b: FBox) => `${b.role?.label ?? ""}|${b.address}|${b.boxId ?? ""}`;
  return [...boxes].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

function spentWith(f: Facts, test: (r: RoleEntry) => boolean): FBox[] {
  return stable(f.ins.filter((b) => b.role != null && test(b.role)));
}

function createdWith(f: Facts, test: (r: RoleEntry) => boolean): FBox[] {
  return stable(f.outs.filter((b) => b.role != null && test(b.role)));
}

function hasRole(boxes: FBox[], role: ContractRole): boolean {
  return boxes.some((b) => b.role?.role === role);
}

function sumBags(boxes: FBox[]): Bag {
  let bag: Bag = new Map();
  for (const b of boxes) bag = plus(bag, bagOf(b));
  return bag;
}

function positive(bag: Bag): Amounts {
  return sides(bag).got;
}

function ergGain(f: Facts, addr: string): bigint {
  return f.net.get(addr)?.get(ERG) ?? 0n;
}

/** The wallet that ended up with the most: a token gain first (the thing bought), else ERG. */
function bestGainer(f: Facts, except: ReadonlySet<string> = new Set()): string | null {
  const gainers = walletGainers(f, except);
  if (!gainers.length) return null;
  const withToken = gainers.filter((a) => [...(f.net.get(a) ?? new Map())].some(([k, v]) => k !== ERG && v > 0n));
  const pool = withToken.length ? withToken : gainers;
  return pool.reduce((best, a) => {
    const d = ergGain(f, a) - ergGain(f, best);
    return d > 0n || (d === 0n && a < best) ? a : best;
  }, pool[0]!);
}

/** Wallet payments the actor made to others: «ещё 1.77 ERG → 9gvv…DDPB». */
function extrasFrom(
  f: Facts,
  actor: string,
  skip: ReadonlySet<string> = new Set(),
  scriptsToo = false
): NonNullable<Draft["extra"]> {
  const out: NonNullable<Draft["extra"]> = [];
  // Only the signer's own money: an executor paying from a contract box is not the actor paying.
  if (actor !== f.payer) return out;
  const except = new Set([actor, ...skip]);
  const to = scriptsToo
    ? [...f.net.keys()].filter((a) => !except.has(a) && [...f.net.get(a)!.values()].some((v) => v > 0n)).sort()
    : walletGainers(f, except);
  for (const addr of to) {
    // ERG first, then the largest: the same order as the actor's own sides, not the boxes' order.
    for (const [key, amt] of sides(f.net.get(addr) ?? new Map<AssetKey, bigint>()).got) out.push({ to: addr, key, amount: amt });
  }
  return out;
}

function extrasBag(extra: NonNullable<Draft["extra"]>): Bag {
  const bag: Bag = new Map();
  for (const e of extra) addInto(bag, e.key, e.amount);
  return bag;
}

function actorSides(f: Facts, actor: string | null, extra: NonNullable<Draft["extra"]> = []) {
  if (!actor) return { gave: [] as Amounts, got: [] as Amounts };
  // The actor's loss includes what it paid to others; those payments are listed apart.
  return sides(plus(netOf(f, actor), extrasBag(extra)));
}

// ── 1. consensus ────────────────────────────────────────────────────────────

const ruleConsensus: Rule = (f, ctx) => {
  if (hasRole(f.ins, "emission")) {
    const locks = f.outs.filter((b) => b.role?.role === "reward-lock");
    let v = 0n;
    for (const b of locks) v += b.value;
    return {
      action: "block-reward",
      protocol: "ergo",
      conf: "exact",
      actor: stable(locks)[0]?.address ?? null,
      got: v ? [[ERG, v]] : [],
      why: [{ k: "spent", v: "Emission" }],
    };
  }
  if (f.ins.length && f.ins.every((b) => b.fee) && f.outs.length === 1) {
    const out = f.outs[0]!;
    return {
      action: "fee-collect",
      protocol: "ergo",
      conf: "exact",
      actor: out.address,
      count: f.ins.length,
      got: [[ERG, out.value]],
      why: [{ k: "spent", v: "Miner fee", n: f.ins.length }],
    };
  }
  if (f.tx.rent) {
    // Old boxes spent by the miner; whoever ends up with more ERG took the rent. Several takers
    // (a shared payout group) are said as a group: the sum, and the share when all are equal.
    const takers = [...f.net]
      .filter(([, bag]) => (bag.get(ERG) ?? 0n) > 0n)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    let collector: string | null = null;
    let gain = 0n;
    let total = 0n;
    for (const [addr, bag] of takers) {
      const g = bag.get(ERG)!;
      total += g;
      if (g > gain) {
        gain = g;
        collector = addr;
      }
    }
    // Tokens swept out of the old boxes: what any address ended up with more of.
    const swept: Bag = new Map();
    for (const [, bag] of f.net) for (const [k, v] of bag) if (k !== ERG && v > 0n) addInto(swept, k, v);
    const tokens = positive(swept);
    const split = takers.length >= 2;
    const shares = new Set(takers.map(([, bag]) => bag.get(ERG)!));
    const d: Draft = {
      action: "rent",
      protocol: "ergo",
      conf: "exact",
      actor: split ? null : collector,
      count: f.ins.length,
      got: [...((split ? total : gain) ? [[ERG, split ? total : gain] as [AssetKey, bigint]] : []), ...tokens],
      sub: f.tx.rent === "rent-renew" ? "renew" : "collect",
      why: [{ k: "rent", v: f.tx.rent, n: f.ins.length }],
    };
    if (split) {
      d.count2 = takers.length;
      if (shares.size === 1) d.each = [ERG, [...shares][0]!];
    }
    return d;
  }
  const locks = f.ins.filter((b) => b.role?.role === "reward-lock");
  if (locks.length && f.ins.every((b) => !b.role || b.role.p === "ergo")) {
    const lockAddrs = new Set(locks.map((b) => b.address));
    const gainers = walletGainers(f, lockAddrs).filter((a) => ergGain(f, a) > 0n);
    // A wallet that spent a box here and got money back is the pool (its change and share), not a miner.
    const spenders = new Set(f.ins.filter((b) => b.wallet).map((b) => b.address));
    const receivers = gainers.filter((a) => !spenders.has(a));
    const named = stable(locks).find((b) => ctx.nameOf?.(b.address));
    let total = 0n;
    for (const a of receivers) total += ergGain(f, a);
    const extra: NonNullable<Draft["extra"]> = [];
    for (const b of f.outs) {
      // EIP-27: the reward lock pays the reemission share through the emission proxy.
      if (b.role?.role === "reemission" || b.role?.role === "emission-proxy") {
        extra.push({ to: b.address, key: ERG, amount: b.value, role: "reemission" });
      }
    }
    const why: WhyFact[] = [{ k: "spent", v: "Miner reward lock", n: locks.length }];
    if (!receivers.length || (receivers.length === 1 && !named && !spenders.size)) {
      // A miner takes its own reward (into a fresh address or back to its own wallet).
      const actor = receivers[0] ?? gainers[0] ?? f.payer ?? stable(locks)[0]!.address;
      const got = ergGain(f, actor);
      return {
        action: "miner-payout",
        protocol: "ergo",
        conf: "exact",
        actor,
        count: 1,
        count2: locks.length,
        got: got > 0n ? [[ERG, got]] : [],
        extra,
        sub: "claim",
        why,
      };
    }
    // The pool: whoever the reward lock is named after (else the lock itself).
    const lock0 = stable(locks)[0]!;
    return {
      action: "miner-payout",
      protocol: "ergo",
      conf: "exact",
      actor: (named ?? lock0).address,
      count: receivers.length,
      count2: locks.length,
      gave: total ? [[ERG, total]] : [],
      extra,
      sub: "pool",
      why,
    };
  }
  return null;
};

// ── 2. oracle pools ─────────────────────────────────────────────────────────

const ruleOracle: Rule = (f) => {
  const spent = spentWith(f, (r) => r.p === "oracle");
  if (!spent.length) return null;
  const pairOf = (boxes: FBox[]) => oraclePairOf(boxes.flatMap((b) => b.tokenIds));
  const rate = spent.filter((b) =>
    ["oracle-pool", "oracle-refresh", "oracle-live-epoch"].includes(b.role!.role)
  );
  if (rate.length) {
    // v2 spends the datapoints; v1 reads them as data inputs.
    const posts = spent.filter((b) => b.role!.role === "datapoint").length ||
      f.data.filter((b) => b.role?.role === "datapoint").length;
    return {
      action: "oracle-update",
      protocol: "oracle",
      conf: "exact",
      actor: f.payer,
      count: posts,
      pair: pairOf(rate) ?? pairOf(spent),
      feeHidden: false,
      why: [ROLE_WHY(rate[0]!), ...(posts ? [{ k: "datapoints", n: posts }] : [])],
    };
  }
  const prep = spent.find((b) => b.role!.role === "oracle-epoch-prep");
  if (prep) {
    return {
      action: "service",
      protocol: "oracle",
      conf: "exact",
      actor: f.payer,
      sub: "oracle-round",
      pair: pairOf([prep]),
      why: [ROLE_WHY(prep)],
    };
  }
  const post = spent.find((b) => b.role!.role === "datapoint");
  if (post) {
    return {
      action: "oracle-post",
      protocol: "oracle",
      conf: "exact",
      actor: f.payer,
      pair: pairOf([post]),
      why: [ROLE_WHY(post)],
    };
  }
  return {
    action: "service",
    protocol: "oracle",
    conf: "exact",
    actor: f.payer,
    sub: "oracle-governance",
    label: spent[0]!.role!.label,
    pair: pairOf(spent),
    why: [ROLE_WHY(spent[0]!)],
  };
};

// ── 3. pools ────────────────────────────────────────────────────────────────

type PoolMove = { box: FBox; venue: string; kind: "swap" | "lp-add" | "lp-remove" | "other"; delta: Bag; lp: AssetKey | null };

/** An AMM pool box keeps the unissued LP supply (near 2^63 units); a CL position box has none. */
function hasLpSupply(box: FBox): boolean {
  return [...box.assets].some(([, amt]) => amt >= 1_000_000_000_000_000n);
}

/** The pool NFT is the amount-1 token the new pool box carries again. Token order is not trusted. */
function poolMove(box: FBox, outs: FBox[]): PoolMove | null {
  const nfts = [...box.assets].filter(([, amt]) => amt === 1n).map(([id]) => id).sort();
  const next = outs.find((o) => o.role?.p === box.role?.p && nfts.some((id) => o.assets.get(id) === 1n));
  if (!next) {
    // A CL position closed: the box is spent without a successor and its money leaves the contract.
    if (hasLpSupply(box) || box.value === 0n) return null;
    const delta = minus(new Map(), bagOf(box));
    for (const id of nfts) delta.delete(id);
    const venue = box.role!.venue ?? PROTOCOL_NAMES[box.role!.p].en;
    return { box, venue, kind: "lp-remove", delta, lp: null };
  }
  const nft = nfts.find((id) => next.assets.get(id) === 1n)!;
  const delta = minus(bagOf(next), bagOf(box));
  delta.delete(nft);
  const pos = [...delta].filter(([, v]) => v > 0n);
  const neg = [...delta].filter(([, v]) => v < 0n);
  let kind: PoolMove["kind"] = "other";
  let lp: AssetKey | null = null;
  if (pos.length === 1 && neg.length === 1) kind = "swap";
  else if (pos.length >= 2 && neg.length === 1) {
    kind = "lp-add";
    lp = neg[0]![0];
  } else if (neg.length >= 2 && pos.length === 1) {
    kind = "lp-remove";
    lp = pos[0]![0];
  } else if (pos.length && !neg.length && !hasLpSupply(box)) {
    // A position box without an LP supply (CL): money only in = added, only out = removed.
    kind = "lp-add";
  } else if (neg.length && !pos.length && !hasLpSupply(box)) {
    kind = "lp-remove";
  }
  const venue = box.role!.venue ?? PROTOCOL_NAMES[box.role!.p].en;
  return { box, venue, kind, delta, lp };
}

function pairName(keys: AssetKey[], ctx: MeaningCtx): string {
  return keys
    .map((k) => (k === ERG ? "ERG" : ctx.token?.(k)?.name?.trim() || `${k.slice(0, 6)}…`))
    .join("/");
}

const rulePoolCreate: Rule = (f, ctx) => {
  for (const out of stable(f.outs)) {
    if (out.role?.role !== "pool") continue;
    const born = [...out.assets].find(([id, amt]) => amt === 1n && f.minted.has(id));
    // Or the NFT came from an earlier tx and this one mints the LP supply into the new pool.
    const lpBorn = born ? undefined : [...out.assets].find(([id, amt]) => amt >= 1_000_000_000_000_000n && f.minted.has(id));
    if (!born && !lpBorn && !out.tokenIds.some((id) => ctx.poolNftIds?.has(id) && f.inputIds.has(id))) continue;
    if (f.ins.some((b) => b.role?.role === "pool" && b.role.p === out.role!.p)) continue;
    const nft =
      born?.[0] ??
      (lpBorn ? [...out.assets].find(([, amt]) => amt === 1n)?.[0] : undefined) ??
      out.tokenIds.find((id) => ctx.poolNftIds?.has(id)) ??
      null;
    const mintedId = born?.[0] ?? lpBorn?.[0] ?? null;
    // Left in the pool: the LP supply (largest amount) and the reserves.
    const rest = [...out.assets].filter(([id]) => id !== nft).sort((a, b) => (a[1] > b[1] ? -1 : 1));
    const tokens = rest.length >= 2 ? rest.slice(1).map(([id]) => id) : rest.map(([id]) => id);
    const reserves: AssetKey[] = tokens.length >= 2 ? tokens.slice(0, 2) : [ERG, ...tokens];
    const actor = f.payer;
    const { gave, got } = actorSides(f, actor);
    return {
      action: "pool-create",
      protocol: out.role.p,
      conf: "exact",
      actor,
      gave,
      got,
      venues: [out.role.venue ?? PROTOCOL_NAMES[out.role.p].en],
      pair: pairName(reserves, ctx),
      secondary: [],
      why: [{ k: "created", v: out.role.label }, ...(mintedId ? [{ k: "minted", v: mintedId }] : [])],
    };
  }
  return null;
};

function isOrderBox(f: Facts, b: FBox): boolean {
  if (b.role?.role === "order") return true;
  // An unknown script spent next to a pool and not recreated: the user's order box.
  return !b.role && !b.wallet && !b.fee && !f.outs.some((o) => o.address === b.address);
}

function regHex(v: unknown): string {
  const hex = typeof v === "string" ? v : (v as { serializedValue?: string } | null)?.serializedValue;
  return (hex ?? "").toLowerCase();
}

/**
 * The order box recreated in this tx and bound to its parent by the parent's id in a register
 * (MachinaFi grid R6 / limit R7: Coll[Byte] = SELF.id). Present = the order was filled, not closed.
 */
function boundChild(f: Facts, b: FBox): FBox | null {
  if (b.role?.role !== "order" || !b.boxId) return null;
  const tag = `0e20${b.boxId.toLowerCase()}`;
  return (
    f.outs.find(
      (o) => o.address === b.address && Object.values(o.raw.additionalRegisters ?? {}).some((v) => regHex(v) === tag)
    ) ?? null
  );
}

/** The owner of a MachinaFi order: R4 is the owner's SigmaProp; only a plain key is read. */
function orderOwner(b: FBox): string | null {
  if (b.role?.p !== "machinafi") return null;
  const r4 = regHex(b.raw.additionalRegisters?.["R4"]);
  if (!/^08cd(02|03)[0-9a-f]{64}$/.test(r4)) return null;
  return p2pkAddressFromCompressedPubkey(r4.slice(4));
}

/** What the filled orders' owners got (positive) and gave (negative): child minus parent. */
function fillBag(f: Facts, filled: FBox[]): Bag {
  let bag: Bag = new Map();
  for (const b of filled) bag = plus(bag, minus(bagOf(boundChild(f, b)!), bagOf(b)));
  return bag;
}

const rulePools: Rule = (f, ctx) => {
  const pools = stable(f.ins.filter((b) => b.role?.role === "pool"));
  if (!pools.length) return null;
  const moves = pools.map((b) => poolMove(b, f.outs)).filter((m): m is PoolMove => m != null);
  // Sorted: input order is not trusted, so the list must not depend on it.
  let venues = [...new Set(pools.map((b) => b.role!.venue ?? PROTOCOL_NAMES[b.role!.p].en))].sort();
  if (!moves.some((m) => m.kind !== "other")) {
    // The pool box was drained or rebuilt, not traded against.
    const actor = f.payer ?? bestGainer(f);
    const { gave, got } = actorSides(f, actor);
    return {
      action: "contract-call",
      protocol: pools[0]!.role!.p,
      conf: "exact",
      actor,
      gave,
      got,
      label: pools[0]!.role!.label,
      why: pools.map((b) => ROLE_WHY(b)),
    };
  }
  let action: MeaningActionId = "swap";
  if (moves.some((m) => m.kind === "lp-add")) action = "lp-add";
  else if (moves.some((m) => m.kind === "lp-remove")) action = "lp-remove";

  // What the user put in / took out is the pools' move, turned around. An order filled next to
  // them (recreated and bound to itself) is one more venue the signer traded against.
  const filled = f.ins.filter((b) => !pools.includes(b) && boundChild(f, b));
  let poolDelta: Bag = new Map();
  for (const m of moves) poolDelta = plus(poolDelta, m.delta);
  poolDelta = plus(poolDelta, fillBag(f, filled));
  const user: Bag = new Map();
  for (const [k, v] of poolDelta) addInto(user, k, -v);
  const { gave, got } = sides(user);
  if (filled.length && (!f.payer || !gave.length)) {
    // A matcher filled an order that trades on its own (grid, partial limit) through the pools and
    // only kept the spread (no signer, or the signer gave nothing): the story is the order's, from
    // its owner's side.
    const owners = [...new Set(filled.map((b) => orderOwner(b)))];
    const sidesOf = sides(fillBag(f, filled));
    const orderVenues = filled.map((b) => b.role!.venue ?? PROTOCOL_NAMES[b.role!.p].en);
    const tallyP = new Map<ProtocolId, number>();
    for (const b of pools) tallyP.set(b.role!.p, (tallyP.get(b.role!.p) ?? 0) + 1);
    return {
      action: "swap",
      protocol: [...tallyP].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0],
      conf: "exact",
      actor: owners.length === 1 ? owners[0]! : null,
      gave: sidesOf.gave,
      got: sidesOf.got,
      venues: [...new Set([...venues, ...orderVenues])].sort(),
      viaOrder: true,
      feeHidden: true,
      why: [...pools.map((b) => ROLE_WHY(b)), ...filled.map((b) => ({ k: "order", v: b.role!.label }))],
    };
  }
  if (filled.length) venues = [...new Set([...venues, ...filled.map((b) => b.role!.venue ?? PROTOCOL_NAMES[b.role!.p].en)])].sort();

  const orders = f.ins.filter((b) => !pools.includes(b) && !filled.includes(b) && isOrderBox(f, b));
  let actor: string | null;
  let noSigner: string | null = null;
  let extra: NonNullable<Draft["extra"]> = [];
  if (filled.length && f.payer) {
    // The signer traded against pools and orders; an order completed on the way is a counterparty.
    actor = f.payer;
    extra = extrasFrom(f, actor);
  } else if (orders.length) {
    actor = bestGainer(f, new Set(f.ins.filter((b) => b.wallet).map((b) => b.address)));
    if (!actor) actor = bestGainer(f);
  } else if (f.payer) {
    actor = f.payer;
    extra = extrasFrom(f, actor);
  } else {
    // A contract traded on its own (no wallet signed): no actor; the venue is the subject.
    const bot = stable(f.ins.filter((b) => !b.wallet && !b.fee && !pools.includes(b) && f.outs.some((o) => o.address === b.address)))[0];
    actor = null;
    noSigner = bot?.address ?? "";
  }
  // The protocol most of the spent pools belong to (ties: by id), not the first box.
  const tally = new Map<ProtocolId, number>();
  for (const b of pools) tally.set(b.role!.p, (tally.get(b.role!.p) ?? 0) + 1);
  const protocol = [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0]![0];
  const why: WhyFact[] = pools.map((b) => ROLE_WHY(b));
  if (filled.length) why.push(...filled.map((b) => ({ k: "order", v: b.role!.label })));
  if (orders.length) why.push(...orders.map((b) => ({ k: "order", v: b.role?.label ?? b.address })));
  if (noSigner != null) why.push(noSigner ? { k: "no-signer", v: noSigner } : { k: "no-signer" });
  return {
    action,
    protocol,
    conf: "exact",
    actor,
    gave,
    got,
    venues,
    extra,
    viaOrder: orders.length > 0,
    feeHidden: orders.length > 0,
    why,
  };
};

/** What an order asks for, when it is not a swap: read off the registry label. */
function orderSub(b: FBox): string | undefined {
  const label = b.role!.label;
  if (/ forward offer$/.test(label)) return "forward";
  if (/ deposit order\b/.test(label)) return "deposit";
  if (/ redeem order\b/.test(label)) return "redeem";
  return undefined;
}

/** The order itself names the answer, not a companion box such as the v2 fee box. */
function orderFirst(boxes: FBox[]): FBox[] {
  const fee = (b: FBox) => Number(/ fee$/.test(b.role!.label));
  return [...boxes].sort((a, b) => fee(a) - fee(b));
}

const ruleOrders: Rule = (f) => {
  const spentOrders = spentWith(f, (r) => r.role === "order");
  // A taker filled the order: recreated and bound to it, or (MachinaFi) completed and paid to its
  // owner by someone who is not the owner. The owner reshaping its own order is not a fill.
  const filled = spentOrders.filter((b) => {
    const owner = orderOwner(b);
    if (owner != null && owner === f.payer) return false;
    if (boundChild(f, b)) return true;
    return owner != null && f.payer != null;
  });
  if (filled.length) {
    const actor = f.payer;
    const { gave, got } = actorSides(f, actor);
    const owners = [...new Set(filled.map((b) => orderOwner(b)))];
    if (!gave.length && owners.length === 1 && owners[0] != null) {
      // The signer put nothing in: it closed someone's order and kept a fee; the owner got the rest.
      const owner = owners[0];
      return {
        action: "order-cancel",
        protocol: filled[0]!.role!.p,
        conf: "exact",
        actor: owner,
        got: actorSides(f, owner).got,
        sub: "closed",
        why: filled.map((b) => ROLE_WHY(b)),
      };
    }
    return {
      action: "swap",
      protocol: filled[0]!.role!.p,
      conf: "exact",
      actor,
      gave,
      got,
      venues: [...new Set(filled.map((b) => b.role!.venue ?? PROTOCOL_NAMES[b.role!.p].en))].sort(),
      why: filled.map((b) => ROLE_WHY(b)),
    };
  }
  const placed = orderFirst(createdWith(f, (r) => r.role === "order"));
  if (placed.length && f.payer && spentOrders.length) {
    // The payer rebuilt its orders (top-up, new prices, regrouping): its own net says what it
    // added or took out; the new boxes also hold what was already in the old ones.
    const { gave, got } = actorSides(f, f.payer);
    const p = placed[0]!.role!.p;
    if (gave.length) {
      return { action: "order-place", protocol: p, conf: "exact", actor: f.payer, gave, sub: orderSub(placed[0]!), why: [ROLE_WHY(placed[0]!, "created")] };
    }
    const first = orderFirst(spentOrders)[0]!;
    if (!got.length) {
      // Same money back in the order, new terms (price, range).
      return { action: "order-place", protocol: p, conf: "exact", actor: f.payer, sub: "update", why: [ROLE_WHY(placed[0]!, "created")] };
    }
    return { action: "order-cancel", protocol: p, conf: "exact", actor: f.payer, got, sub: orderSub(first), why: [ROLE_WHY(first)] };
  }
  if (placed.length && f.payer) {
    const p = placed[0]!.role!.p;
    return {
      action: "order-place",
      protocol: p,
      conf: "exact",
      actor: f.payer,
      // A token minted into the order (the v3 order NFT) is not something the owner gave.
      gave: positive(new Map([...sumBags(placed)].filter(([id]) => !f.minted.has(id)))),
      extra: extrasFrom(f, f.payer),
      sub: orderSub(placed[0]!),
      why: [ROLE_WHY(placed[0]!, "created")],
    };
  }
  const cancelled = orderFirst(spentWith(f, (r) => r.role === "order"));
  if (cancelled.length) {
    const actor = f.payer ?? bestGainer(f);
    const { got } = actorSides(f, actor);
    return {
      action: "order-cancel",
      protocol: cancelled[0]!.role!.p,
      conf: "exact",
      actor,
      got,
      sub: orderSub(cancelled[0]!),
      why: [ROLE_WHY(cancelled[0]!)],
    };
  }
  return null;
};

// ── banks and stablecoins ───────────────────────────────────────────────────

const ruleBanks: Rule = (f) => {
  const bank = spentWith(f, (r) => (r.p === "sigmausd" && r.role === "bank") || (r.p === "dexy" && r.role === "stable-mint"));
  if (!bank.length) return null;
  const p = bank[0]!.role!.p;
  const actor = f.payer ?? bestGainer(f);
  const extra = actor ? extrasFrom(f, actor) : [];
  const { gave, got } = actorSides(f, actor, extra);
  const stable = (k: AssetKey) =>
    p === "sigmausd" ? STABLE_TOKENS.has(k) : k !== ERG;
  const action: MeaningActionId = got.some(([k]) => stable(k))
    ? "stable-mint"
    : gave.some(([k]) => stable(k))
      ? "stable-redeem"
      : "service";
  return {
    action,
    protocol: p,
    conf: "exact",
    actor,
    gave,
    got,
    extra,
    label: bank[0]!.role!.label,
    why: [ROLE_WHY(bank[0]!)],
  };
};

// ── Rosen bridge ────────────────────────────────────────────────────────────

function utf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes).trim();
  } catch {
    return "";
  }
}

function lockChain(b: FBox): string | null {
  const regs = b.raw.additionalRegisters;
  if (!regs) return null;
  const r4 = regs["R4"] as unknown;
  const hex = typeof r4 === "string" ? r4 : (r4 as { serializedValue?: string } | null)?.serializedValue;
  if (!hex) return null;
  const parts = parseCollCollByte(hex);
  const chain = parts?.[0] ? utf8(parts[0]) : "";
  return chain || null;
}

const ruleRosen: Rule = (f) => {
  const spent = spentWith(f, (r) => r.p === "rosen");
  const locked = createdWith(f, (r) => r.role === "bridge-lock");
  if (!spent.length && !locked.length) return null;
  const trigger = spent.find((b) => b.role!.role === "bridge-trigger");
  if (trigger) {
    const ev = extractEventFromRegisters(trigger.raw.additionalRegisters ?? null);
    if (ev && ev.fromChain.toLowerCase() === "ergo") {
      return {
        action: "service",
        protocol: "rosen",
        conf: "exact",
        actor: null,
        sub: "bridge-settle",
        chain: chainLabel(ev.toChain),
        why: [ROLE_WHY(trigger)],
      };
    }
    let actor: string | null = null;
    if (ev?.toAddress && f.net.has(ev.toAddress)) actor = ev.toAddress;
    if (!actor) {
      // The user is paid the most ERG; watchers and guards get small shares.
      const gainers = walletGainers(f, new Set());
      actor = gainers.reduce<string | null>((best, a) => (best == null || ergGain(f, a) > ergGain(f, best) ? a : best), null);
    }
    const { got } = actorSides(f, actor);
    return {
      action: "bridge-in",
      protocol: "rosen",
      conf: "exact",
      actor,
      got,
      chain: ev?.fromChain ? chainLabel(ev.fromChain) : null,
      feeHidden: true,
      why: [ROLE_WHY(trigger)],
    };
  }
  if (locked.length && !spent.some((b) => b.role!.role === "bridge-lock") && f.payer) {
    const lockAddrs = new Set(locked.map((b) => b.address));
    const c = lockChain(locked[0]!);
    return {
      action: "bridge-out",
      protocol: "rosen",
      // The lock is known; without its registers the other side is not read, only the flow.
      conf: c ? "exact" : "flow",
      actor: f.payer,
      gave: positive(sumBags(locked)),
      extra: extrasFrom(f, f.payer, lockAddrs, true),
      chain: c ? chainLabel(c) : null,
      why: [ROLE_WHY(locked[0]!, "created"), ...(c ? [] : [{ k: "no-registers" }])],
    };
  }
  const permit = spent.find((b) => b.role!.role === "bridge-permit");
  if (permit && hasRole(f.outs, "bridge-commitment")) {
    return {
      action: "service",
      protocol: "rosen",
      conf: "exact",
      actor: f.payer,
      sub: "watcher-report",
      why: [ROLE_WHY(permit), { k: "created", v: "Rosen Commitment" }],
    };
  }
  const any = spent[0] ?? locked[0]!;
  return {
    action: "service",
    protocol: "rosen",
    conf: "exact",
    actor: f.payer,
    label: any.role!.label,
    why: [ROLE_WHY(any, spent.length ? "spent" : "created")],
  };
};

// ── Lithos mining ───────────────────────────────────────────────────────────

const ruleLithos: Rule = (f) => {
  const spent = spentWith(f, (r) => r.p === "lithos");
  if (!spent.length) return null;
  const pay = spent.find((b) => b.role!.role === "payout");
  if (pay && f.payer) {
    const { got } = actorSides(f, f.payer);
    if (got.length) {
      return { action: "payout", protocol: "lithos", conf: "exact", actor: f.payer, got, why: [ROLE_WHY(pay)] };
    }
  }
  return {
    action: "service",
    protocol: "lithos",
    conf: "exact",
    actor: f.payer,
    label: spent[0]!.role!.label,
    why: [ROLE_WHY(spent[0]!)],
  };
};

// ── lending ─────────────────────────────────────────────────────────────────

const ruleLending: Rule = (f) => {
  const bondOut = createdWith(f, (r) => r.role === "bond");
  const bondIn = spentWith(f, (r) => r.role === "bond");
  if (bondOut.length && !f.payer) {
    // Matched by a bot (no wallet signed): told from the borrower's side, the one who got the loan.
    const actor = bestGainer(f);
    if (actor) {
      const { got } = actorSides(f, actor);
      return { action: "loan", protocol: bondOut[0]!.role!.p, conf: "exact", actor, got, sub: "borrow", why: [ROLE_WHY(bondOut[0]!, "created")] };
    }
  }
  if (bondOut.length) {
    const actor = f.payer;
    const extra = actor ? extrasFrom(f, actor) : [];
    const { gave } = actorSides(f, actor, extra);
    return {
      action: "loan",
      protocol: bondOut[0]!.role!.p,
      conf: "exact",
      actor,
      gave,
      sub: "lend",
      counterparty: extra[0]?.to ?? null,
      extra: extra.slice(1),
      why: [ROLE_WHY(bondOut[0]!, "created")],
    };
  }
  if (bondIn.length) {
    const actor = f.payer ?? bestGainer(f);
    // Repaid into the lender's vault: the vault holds the repayment, the collateral came back.
    const vault = createdWith(f, (r) => r.role === "payout" && r.p === bondIn[0]!.role!.p);
    if (vault.length) {
      return {
        action: "loan-repay",
        protocol: bondIn[0]!.role!.p,
        conf: "exact",
        actor,
        // The bond's own tokens move into the vault with the repayment; they are not paid.
        gave: positive(new Map([...sumBags(vault)].filter(([k]) => k === ERG || !bondIn.some((x) => bagOf(x).has(k))))),
        why: [ROLE_WHY(bondIn[0]!), ROLE_WHY(vault[0]!, "created")],
      };
    }
    const { gave, got } = actorSides(f, actor);
    return {
      action: gave.length ? "loan-repay" : "loan",
      protocol: bondIn[0]!.role!.p,
      conf: "exact",
      actor,
      gave,
      got,
      sub: gave.length ? undefined : "claim",
      why: [ROLE_WHY(bondIn[0]!)],
    };
  }
  const reqOut = createdWith(f, (r) => r.role === "loan-order");
  if (reqOut.length && f.payer) {
    return {
      action: "loan",
      protocol: reqOut[0]!.role!.p,
      conf: "exact",
      actor: f.payer,
      gave: positive(sumBags(reqOut)),
      sub: "request",
      why: [ROLE_WHY(reqOut[0]!, "created")],
    };
  }
  const reqIn = spentWith(f, (r) => r.role === "loan-order");
  if (reqIn.length) {
    const actor = f.payer ?? bestGainer(f);
    const { got } = actorSides(f, actor);
    return { action: "order-cancel", protocol: reqIn[0]!.role!.p, conf: "exact", actor, got, sub: "loan", why: [ROLE_WHY(reqIn[0]!)] };
  }
  const pool = spentWith(f, (r) => r.role === "lending-pool")[0];
  if (pool) {
    // Read the pool box: ERG in and its tokens out = deposit; the reverse = withdrawal;
    // ERG out alone = borrow; ERG in alone = repay. Not decoded from the script: a guess.
    const next = f.outs.find((o) => o.address === pool.address);
    const d = next ? minus(bagOf(next), bagOf(pool)) : new Map<AssetKey, bigint>();
    const erg = d.get(ERG) ?? 0n;
    const tok = [...d].filter(([k]) => k !== ERG);
    const tokOut = tok.some(([, v]) => v < 0n);
    const tokIn = tok.some(([, v]) => v > 0n);
    let action: MeaningActionId = "loan";
    let sub: string | undefined = "borrow";
    if (erg > 0n && tokOut) [action, sub] = ["stake", undefined];
    else if (erg < 0n && tokIn) [action, sub] = ["unstake", undefined];
    else if (erg > 0n) [action, sub] = ["loan-repay", undefined];
    // Proxy boxes carry the user's money, so read the amounts off the pool box, turned around.
    const user: Bag = new Map();
    for (const [k, v] of d) addInto(user, k, -v);
    const { gave, got } = sides(user);
    const actor = bestGainer(f, new Set(f.ins.filter((b) => b.wallet).map((b) => b.address))) ?? f.payer;
    return { action, protocol: pool.role!.p, conf: "guess", actor, gave, got, sub, why: [ROLE_WHY(pool)] };
  }
  const loanBox = spentWith(f, (r) => r.role === "loan-box")[0] ?? createdWith(f, (r) => r.role === "loan-box")[0];
  if (loanBox) {
    const actor = f.payer ?? bestGainer(f);
    const { gave, got } = actorSides(f, actor);
    return { action: "loan", protocol: loanBox.role!.p, conf: "guess", actor, gave, got, why: [ROLE_WHY(loanBox)] };
  }
  return null;
};

// ── names, auction, mixer, deposits, reserves ───────────────────────────────

function mintedName(f: Facts, ctx: MeaningCtx): { id: string; name: string | null } | null {
  for (const id of [...f.minted.keys()].sort()) {
    const name = ctx.token?.(id)?.name?.trim() || null;
    return { id, name };
  }
  return null;
}

const ruleNames: Rule = (f, ctx) => {
  const spent = spentWith(f, (r) => r.p === "ergonames");
  const created = createdWith(f, (r) => r.p === "ergonames");
  if (!spent.length && !created.length) return null;
  const reg = spent.find((b) => b.role!.role === "name-registry");
  if (reg) {
    const nm = mintedName(f, ctx);
    // The name NFT lands with the buyer; the executor only signs.
    let actor: string | null = null;
    const wallets = new Set(f.outs.filter((b) => b.wallet).map((b) => b.address));
    if (nm) for (const [addr, bag] of f.net) if (wallets.has(addr) && (bag.get(nm.id) ?? 0n) > 0n) actor = addr;
    return {
      action: "name-register",
      protocol: "ergonames",
      conf: "exact",
      actor: actor ?? f.payer,
      got: nm ? [[nm.id, f.minted.get(nm.id)!]] : [],
      label: nm?.name ?? undefined,
      feeHidden: actor != null && actor !== f.payer,
      why: [ROLE_WHY(reg), ...(nm ? [{ k: "minted", v: nm.id }] : [])],
    };
  }
  const commit = created.find((b) => b.role!.role === "name-commit" || b.role!.role === "name-reveal");
  if (commit && f.payer) {
    return {
      action: "name-register",
      protocol: "ergonames",
      conf: "exact",
      actor: f.payer,
      gave: positive(sumBags([commit])),
      sub: "commit",
      why: [ROLE_WHY(commit, "created")],
    };
  }
  const any = spent[0] ?? created[0]!;
  return {
    action: "service",
    protocol: "ergonames",
    conf: "exact",
    actor: f.payer,
    label: any.role!.label,
    why: [ROLE_WHY(any, spent.length ? "spent" : "created")],
  };
};

const ruleAuction: Rule = (f) => {
  const spent = spentWith(f, (r) => r.role === "lot");
  const created = createdWith(f, (r) => r.role === "lot");
  if (!spent.length && !created.length) return null;
  const actor = f.payer ?? bestGainer(f);
  const extra = actor && spent.length ? extrasFrom(f, actor) : [];
  const { gave, got } = actorSides(f, actor, extra);
  const sub = !spent.length ? "list" : created.length ? "bid" : "settle";
  return {
    action: "auction",
    protocol: (spent[0] ?? created[0])!.role!.p,
    conf: "exact",
    actor,
    gave,
    got,
    sub,
    why: [ROLE_WHY((spent[0] ?? created[0])!, spent.length ? "spent" : "created")],
  };
};

const ruleMixer: Rule = (f) => {
  const hit = spentWith(f, (r) => r.role === "mixer")[0] ?? createdWith(f, (r) => r.role === "mixer")[0];
  if (!hit) return null;
  return { action: "mix", protocol: hit.role!.p, conf: "exact", actor: null, why: [ROLE_WHY(hit)] };
};

const ruleDeposits: Rule = (f) => {
  const bank = spentWith(f, (r) => r.role === "bank" && r.p === "phoenix")[0];
  if (bank) {
    const actor = f.payer ?? bestGainer(f);
    const { gave, got } = actorSides(f, actor);
    const action: MeaningActionId = got.some(([k]) => k !== ERG) ? "stake" : "unstake";
    return { action, protocol: "phoenix", conf: "exact", actor, gave, got, label: bank.role!.label, why: [ROLE_WHY(bank)] };
  }
  const reserve = spentWith(f, (r) => r.role === "reserve")[0];
  const reserveOut = createdWith(f, (r) => r.role === "reserve")[0];
  if (reserve || reserveOut) {
    const before = reserve ? bagOf(reserve) : new Map<AssetKey, bigint>();
    const after = f.outs.find((o) => o.role?.role === "reserve" && (!reserve || o.address === reserve.address));
    const d = minus(after ? bagOf(after) : new Map(), before);
    const erg = d.get(ERG) ?? 0n;
    const action: MeaningActionId = erg >= 0n ? "stake" : "payout";
    let actor = f.payer ?? bestGainer(f);
    if (action === "payout") actor = bestGainer(f, new Set(f.payer ? [f.payer] : [])) ?? actor;
    const { gave, got } = actorSides(f, actor);
    const box = (reserve ?? reserveOut)!;
    return {
      action,
      protocol: box.role!.p,
      conf: "exact",
      actor,
      gave,
      got,
      sub: !reserve ? "open" : action === "payout" ? "reserve" : undefined,
      counterparty: action === "payout" && f.payer !== actor ? f.payer : null,
      label: box.role!.label,
      why: [ROLE_WHY(box, reserve ? "spent" : "created")],
    };
  }
  return null;
};

const ruleDexyRest: Rule = (f) => {
  const spent = spentWith(f, (r) => r.p === "dexy");
  if (!spent.length) return null;
  const pay = spent.find((b) => b.role!.role === "payout");
  const actor = f.payer ?? bestGainer(f);
  if (pay && actor) {
    const { got } = actorSides(f, actor);
    if (got.length) return { action: "payout", protocol: "dexy", conf: "exact", actor, got, why: [ROLE_WHY(pay)] };
  }
  return { action: "service", protocol: "dexy", conf: "exact", actor, label: spent[0]!.role!.label, why: [ROLE_WHY(spent[0]!)] };
};

/** A known contract spent or paid into, no rule for its role: say so with its name. */
const ruleKnownContract: Rule = (f) => {
  // Ergo's own contracts have their rules; one known by name only (the miner tip box) is said here.
  const named = (b: FBox) => b.role != null && (b.role.p !== "ergo" || b.role.role === "contract");
  const spent = stable(f.ins.filter(named))[0];
  const created = stable(f.outs.filter(named))[0];
  const hit = spent ?? created;
  if (!hit) return null;
  const actor = f.payer;
  const extra: NonNullable<Draft["extra"]> = [];
  const { gave, got } = actorSides(f, actor, extra);
  // An upkeep contract (config, governance, vault) is protocol housekeeping, not a user call.
  const upkeep = hit.role!.role === "upkeep";
  return {
    action: upkeep ? "service" : spent ? "contract-call" : "to-contract",
    protocol: hit.role!.p,
    conf: hit.role!.src === "guess" ? "guess" : "exact",
    actor,
    counterparty: hit.address,
    gave,
    got,
    label: hit.role!.label,
    why: [ROLE_WHY(hit, spent ? "spent" : "created")],
  };
};

// ── 4. issue and burn ───────────────────────────────────────────────────────

const ruleIssue: Rule = (f, ctx) => {
  if (!f.minted.size) return null;
  const [id, amt] = [...f.minted].sort((a, b) => (a[1] > b[1] ? -1 : a[1] < b[1] ? 1 : a[0] < b[0] ? -1 : 1))[0]!;
  const dec = ctx.token?.(id)?.decimals ?? 0;
  const nft = amt === 1n && !dec;
  const unknownScript = stable(f.ins.filter((b) => !b.wallet && !b.fee && !b.role))[0];
  // Where the new token landed: the issuer, unless it went straight to someone else.
  let actor = f.payer;
  if (!actor) for (const [addr, bag] of f.net) if ((bag.get(id) ?? 0n) > 0n) actor = addr;
  return {
    action: nft ? "nft-mint" : "token-issue",
    protocol: null,
    conf: "exact",
    actor,
    got: [[id, amt]],
    secondary: unknownScript ? ["contract-call"] : [],
    counterparty: unknownScript?.address ?? null,
    why: [{ k: "minted", v: id }],
  };
};

const ruleBurn: Rule = (f) => {
  if (!f.burned.size || !f.payer) return null;
  const others = walletGainers(f, new Set([f.payer])).length;
  const scripts = f.ins.some((b) => !b.wallet && !b.fee);
  if (others || scripts) return null;
  return {
    action: "burn",
    protocol: null,
    conf: "exact",
    actor: f.payer,
    gave: [...f.burned].map(([k, v]): [AssetKey, bigint] => [k, v]),
    why: [...f.burned.keys()].map((id) => ({ k: "burned", v: id })),
  };
};

// ── 5–6. contracts nobody knows, wallet moves ───────────────────────────────

const ruleUnknownContract: Rule = (f) => {
  const script = stable(f.ins.filter((b) => !b.wallet && !b.fee && !b.role))[0];
  if (!script) return null;
  const actor = f.payer;
  const { gave, got } = actorSides(f, actor);
  return {
    action: "contract-call",
    protocol: null,
    conf: "unknown",
    actor,
    counterparty: script.address,
    gave,
    got,
    why: [{ k: "spent-unknown", v: script.raw.templateHash ?? script.address }],
  };
};

const ruleWallets: Rule = (f, ctx) => {
  const payer = f.payer;
  if (!payer) {
    return { action: "contract-call", protocol: null, conf: "unknown", actor: null, why: [{ k: "no-signer" }] };
  }
  const receivers = walletGainers(f, new Set([payer]));
  const scriptsOut = stable(f.outs.filter((b) => !b.wallet && !b.fee && ergGain(f, b.address) > 0n));
  const net = netOf(f, payer);
  const why: WhyFact[] = [{ k: "fee-payer" }];
  const payerBox = f.ins.find((b) => b.address === payer);
  if (payerBox?.multisig) why.push({ k: "multisig", v: `${payerBox.multisig.k}/${payerBox.multisig.n}` });
  const burnt = f.burned.size ? (["burn"] as MeaningActionId[]) : [];
  if (!receivers.length && scriptsOut.length) {
    const to = scriptsOut[0]!;
    const { gave } = sides(net);
    return {
      action: "to-contract",
      protocol: null,
      conf: "unknown",
      actor: payer,
      counterparty: to.address,
      gave,
      secondary: burnt,
      why: [...why, { k: "created-unknown", v: to.raw.templateHash ?? to.address }],
    };
  }
  if (!receivers.length) {
    const nIn = f.ins.length;
    const nOut = f.outs.filter((b) => !b.fee).length;
    if (nIn >= 3 && nOut < nIn) {
      return { action: "consolidate", protocol: null, conf: "flow", actor: payer, count: nIn, count2: nOut, secondary: burnt, why };
    }
    return { action: "self", protocol: null, conf: "flow", actor: payer, secondary: burnt, why };
  }
  const { gave } = sides(net);
  if (receivers.length >= 3 || (f.truncated && (f.tx.outputCount ?? 0) > 4)) {
    const count = f.truncated ? Math.max(receivers.length, (f.tx.outputCount ?? 0) - 2) : receivers.length;
    return { action: "multisend", protocol: null, conf: "flow", actor: payer, count, gave, secondary: burnt, why };
  }
  // The receiver with the most ERG is the counterparty; a second one is listed apart.
  const sorted = [...receivers].sort((a, b) => {
    const d = ergGain(f, b) - ergGain(f, a);
    return d > 0n ? 1 : d < 0n ? -1 : a < b ? -1 : 1;
  });
  const to = sorted[0]!;
  const extra = extrasFrom(f, payer, new Set([to]));
  const own = sides(plus(net, extrasBag(extra)));
  const mine = ctx.nameOf?.(payer)?.name;
  const sub = mine && mine === ctx.nameOf?.(to)?.name ? "own" : undefined;
  return {
    action: "send",
    sub,
    protocol: null,
    conf: "flow",
    actor: payer,
    counterparty: to,
    gave: own.gave,
    extra,
    secondary: burnt,
    why,
  };
};

export const RULES: ReadonlyArray<[string, Rule]> = [
  ["consensus", ruleConsensus],
  ["oracle", ruleOracle],
  ["pool-create", rulePoolCreate],
  ["pools", rulePools],
  ["orders", ruleOrders],
  ["banks", ruleBanks],
  ["rosen", ruleRosen],
  ["lithos", ruleLithos],
  ["lending", ruleLending],
  ["names", ruleNames],
  ["auction", ruleAuction],
  ["mixer", ruleMixer],
  ["deposits", ruleDeposits],
  ["dexy", ruleDexyRest],
  ["known-contract", ruleKnownContract],
  ["issue", ruleIssue],
  ["burn", ruleBurn],
  ["unknown-contract", ruleUnknownContract],
  ["wallets", ruleWallets],
];

/**
 * ERG a token box carries just to exist: a wallet puts 0.001–0.0011 ERG next to a token. At or
 * under this per box, the ERG is not what moved; the token is.
 */
export const DUST_PER_BOX = 1_100_000n;

/** Boxes that carry any of these tokens, to `owner` (or to anyone but `owner`), at least one. */
function tokenBoxes(f: Facts, tokens: AssetKey[], owner: string | null, toOwner: boolean): number {
  const n = f.outs.filter(
    (b) => !b.fee && (owner == null || (b.address === owner) === toOwner) && tokens.some((t) => b.assets.has(t))
  ).length;
  return Math.max(1, n);
}

/** ERG dust next to tokens goes to the tail: «24.10 rpnADA и 0.0003 ERG», not the other way round. */
function dustLast(list: Amounts | undefined, boxes: (tokens: AssetKey[]) => number): Amounts | undefined {
  if (!list || list.length < 2) return list;
  const erg = list.find(([k]) => k === ERG);
  const tokens = list.filter(([k]) => k !== ERG).map(([k]) => k);
  if (!erg || !tokens.length || erg[1] > DUST_PER_BOX * BigInt(boxes(tokens))) return list;
  return [...list.filter(([k]) => k !== ERG), erg];
}

function dustOrder(f: Facts, d: Draft): Draft {
  const out: Draft = { ...d };
  // Rent is ERG taken from old boxes: the ERG is the point, not dust.
  if (d.action !== "rent") out.got = dustLast(d.got, (t) => tokenBoxes(f, t, d.actor, true));
  out.gave = dustLast(d.gave, (t) => tokenBoxes(f, t, d.actor, false));
  if (d.extra?.length) {
    // Per receiver, in the receivers' own order: only the ERG entry moves behind its tokens.
    const by = new Map<string, NonNullable<Draft["extra"]>>();
    for (const e of d.extra) {
      const k = `${e.role ?? ""}|${e.to}`;
      by.set(k, [...(by.get(k) ?? []), e]);
    }
    out.extra = [...by.values()].flatMap((rows) => {
      const to = rows[0]!.to;
      const order = dustLast(
        rows.map((e) => [e.key, e.amount] as [AssetKey, bigint]),
        (t) => tokenBoxes(f, t, to, true)
      )!;
      return order.map(([k]) => rows.find((e) => e.key === k)!);
    });
  }
  return out;
}

/** First rule that answers wins; a mint under another action is added as secondary. */
export function runRules(f: Facts, ctx: MeaningCtx): Draft & { rule: string } {
  for (const [name, rule] of RULES) {
    const found = rule(f, ctx);
    if (!found) continue;
    const d = dustOrder(f, found);
    const secondary = new Set(d.secondary ?? []);
    if (f.minted.size && !["token-issue", "nft-mint", "pool-create", "name-register", "block-reward"].includes(d.action)) {
      const [id, amt] = [...f.minted].sort((a, b) => (a[0] < b[0] ? -1 : 1))[0]!;
      const dec = ctx.token?.(id)?.decimals ?? 0;
      secondary.add(amt === 1n && !dec ? "nft-mint" : "token-issue");
    }
    secondary.delete(d.action);
    return { ...d, secondary: [...secondary], rule: name };
  }
  return { action: "contract-call", protocol: null, conf: "unknown", actor: null, why: [], rule: "none" };
}
