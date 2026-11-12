/**
 * Tx meaning: one module for every page. classifyTxMeaning(tx, ctx) → TxMeaning.
 * Pure and order-free; computed at read time. Bump TX_MEANING_VERSION when an answer changes.
 */
import { readFacts } from "./facts.js";
import { runRules } from "./rules.js";
import { sayDraft, toAsset } from "./summary.js";
import type { MeaningCtx, MeaningTx, TxMeaning } from "./types.js";
import { MEANING_VOCAB, isServiceAction } from "./vocab.js";

export const TX_MEANING_VERSION = 1;

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
    say: sayDraft(d, ctx),
    rule: d.rule,
  };
  const actorName = d.actor ? ctx.nameOf?.(d.actor)?.name : null;
  if (actorName) m.actorName = actorName;
  const cpName = d.counterparty ? ctx.nameOf?.(d.counterparty)?.name : null;
  if (cpName) m.counterpartyName = cpName;
  if (d.count != null) m.count = d.count;
  if (d.viaOrder) m.viaOrder = true;
  if (d.chain) m.chain = d.chain;
  if (f.truncated) m.truncated = true;
  return m;
}

export { readFacts, multisigOf, shortAddr } from "./facts.js";
export { formatAmount, tokenLabel } from "./summary.js";
export { meaningView, type MeaningView, type MeaningViewRole } from "./perspective.js";
export {
  PROTOCOL_NAMES,
  protocolName,
  roleByTemplate,
  roleByToken,
  knownTemplateCount,
  type ProtocolId,
  type ContractRole,
  type RoleEntry,
} from "./registry.js";
export * from "./types.js";
export * from "./vocab.js";
