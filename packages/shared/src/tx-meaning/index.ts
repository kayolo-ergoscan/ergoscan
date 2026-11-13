/**
 * Tx meaning: one module for every page. classifyTxMeaning(tx, ctx) → TxMeaning.
 * Pure and order-free; computed at read time. Bump TX_MEANING_VERSION when an answer changes.
 */
import { readFacts } from "./facts.js";
import { runRules } from "./rules.js";
import { sayLines, toAsset } from "./summary.js";
import type { CompactMeaning, MeaningAssetLike, MeaningCtx, MeaningTx, TxMeaning } from "./types.js";
import { MEANING_VOCAB, isServiceAction } from "./vocab.js";

export const TX_MEANING_VERSION = 3;

export function classifyTxMeaning(tx: MeaningTx, ctx: MeaningCtx = {}): TxMeaning {
  const f = readFacts(tx);
  const d = runRules(f, ctx);
  const word = MEANING_VOCAB[d.action];
  const why = [...d.why];
  if (f.truncated) why.push({ k: "truncated", n: (tx.inputCount ?? 0) + (tx.outputCount ?? 0) });
  const m: TxMeaning = {
    v: TX_MEANING_VERSION,
    action: d.action,
    family: word.family,
    service: isServiceAction(d.action),
    protocol: d.protocol,
    conf: d.conf,
    actor: d.actor,
    counterparty: d.counterparty ?? null,
    gave: (d.gave ?? []).map(([k, v]) => toAsset(k, v, ctx)),
    got: (d.got ?? []).map(([k, v]) => toAsset(k, v, ctx)),
    // The network fee is shown to whoever paid it; an executor's fee is not the user's cost.
    fee: { payer: d.feeHidden ? null : f.payer, nano: f.feeNano.toString() },
    venues: d.venues ?? [],
    extra: (d.extra ?? []).map((e) => {
      const name = e.role ? null : (ctx.nameOf?.(e.to)?.name ?? null);
      return {
        to: e.to,
        asset: toAsset(e.key, e.amount, ctx),
        ...(e.role ? { role: e.role } : {}),
        ...(name ? { name } : {}),
      };
    }),
    secondary: d.secondary ?? [],
    why,
    rule: d.rule,
    say: { ru: "", en: "" },
  };
  const actorName = d.actor ? ctx.nameOf?.(d.actor)?.name : null;
  if (actorName) m.actorName = actorName;
  const cpName = d.counterparty ? ctx.nameOf?.(d.counterparty)?.name : null;
  if (cpName) m.counterpartyName = cpName;
  if (d.count != null) m.count = d.count;
  if (d.viaOrder) m.viaOrder = true;
  if (d.chain) m.chain = d.chain;
  if (f.truncated) m.truncated = true;
  if (d.sub) m.sub = d.sub;
  if (d.label) m.label = d.label;
  if (d.pair) m.pair = d.pair;
  if (d.count2 != null) m.count2 = d.count2;
  // The phrase is built from the meaning alone, so lists (CompactMeaning) get the same words.
  m.say = sayLines(m);
  return m;
}

function compactAsset(a: MeaningAssetLike): MeaningAssetLike {
  if (!a.token) return { amount: a.amount };
  const out: MeaningAssetLike = { token: a.token, amount: a.amount };
  if (a.name) out.name = a.name;
  if (a.decimals) out.decimals = a.decimals;
  return out;
}

/**
 * The list form: what a row needs to show and fold, nothing it already has. No phrase, no
 * «how», no fee amount (the row has `fee`), no family (MEANING_VOCAB has it), defaults left out.
 * sayMeaning(compactMeaning(m), lang) === m.say[lang].
 */
export function compactMeaning(m: TxMeaning): CompactMeaning {
  const c: CompactMeaning = { v: m.v, action: m.action };
  if (m.protocol) c.protocol = m.protocol;
  if (m.service) c.service = true;
  if (m.conf !== "exact") c.conf = m.conf;
  if (m.actor) c.actor = m.actor;
  if (m.actorName) c.actorName = m.actorName;
  if (m.counterparty) c.counterparty = m.counterparty;
  if (m.counterpartyName) c.counterpartyName = m.counterpartyName;
  if (m.count) c.count = m.count;
  if (m.count2) c.count2 = m.count2;
  if (m.gave.length) c.gave = m.gave.map(compactAsset);
  if (m.got.length) c.got = m.got.map(compactAsset);
  if (m.fee.nano !== "0" && m.fee.payer !== m.actor) c.feePayer = m.fee.payer;
  if (m.venues.length) c.venues = m.venues;
  if (m.extra.length) {
    c.extra = m.extra.map((e) => ({
      to: e.to,
      asset: compactAsset(e.asset),
      ...(e.role ? { role: e.role } : {}),
      ...(e.name ? { name: e.name } : {}),
    }));
  }
  if (m.secondary.length) c.secondary = m.secondary;
  if (m.viaOrder) c.viaOrder = true;
  if (m.chain) c.chain = m.chain;
  if (m.truncated) c.truncated = true;
  if (m.sub) c.sub = m.sub;
  if (m.label) c.label = m.label;
  if (m.pair) c.pair = m.pair;
  return c;
}

export { readFacts, multisigOf, shortAddr } from "./facts.js";
export { assetLabel, assetText, extraNote, formatAmount, sayLines, sayMeaning } from "./summary.js";
export { meaningOwnerRow, meaningView, type MeaningOwnerRow, type MeaningView, type MeaningViewRole } from "./perspective.js";
export {
  PROTOCOL_NAMES,
  protocolName,
  roleByTemplate,
  roleByToken,
  knownTemplateCount,
  TEMPLATES_WITH_REGISTERS,
  type ProtocolId,
  type ContractRole,
  type RoleEntry,
} from "./registry.js";
export * from "./types.js";
export * from "./vocab.js";
export { meaningRow, type MeaningParty, type MeaningRow, type MeaningRowInput } from "./row.js";
export {
  meaningPage,
  ruleWord,
  sayHow,
  type MeaningCard,
  type MeaningFlow,
  type MeaningPage,
  type MeaningPageInput,
} from "./page.js";
