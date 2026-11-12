/**
 * The 34 words a transaction can be called. One id per main action; the web maps the id to
 * the tile colour and glyph. `family` groups the words; "service" rows fold on the lists.
 */

export type MeaningActionId =
  | "send"
  | "multisend"
  | "self"
  | "consolidate"
  | "block-reward"
  | "fee-collect"
  | "miner-payout"
  | "rent"
  | "token-issue"
  | "nft-mint"
  | "burn"
  | "name-register"
  | "swap"
  | "order-place"
  | "order-cancel"
  | "lp-add"
  | "lp-remove"
  | "pool-create"
  | "stable-mint"
  | "stable-redeem"
  | "loan"
  | "loan-repay"
  | "stake"
  | "unstake"
  | "payout"
  | "auction"
  | "bridge-out"
  | "bridge-in"
  | "mix"
  | "oracle-post"
  | "oracle-update"
  | "service"
  | "contract-call"
  | "to-contract";

export type MeaningFamily = "move" | "mining" | "token" | "defi" | "bridge" | "mixer" | "service" | "unknown";

export type MeaningWord = {
  ru: string;
  en: string;
  family: MeaningFamily;
  /** Quiet tile and title (sent to self, consolidation, upkeep). */
  quiet?: boolean;
  /** Made by machines, not people (oracle posts, block rewards and fees, upkeep): lists fold these. */
  fold?: boolean;
};

export const MEANING_VOCAB: Readonly<Record<MeaningActionId, MeaningWord>> = {
  send: { ru: "Перевод", en: "Transfer", family: "move" },
  multisend: { ru: "Массовая отправка", en: "Multi-send", family: "move" },
  self: { ru: "Перевод себе", en: "Sent to self", family: "move", quiet: true },
  consolidate: { ru: "Объединение боксов", en: "Consolidation", family: "move", quiet: true },
  "block-reward": { ru: "Награда за блок", en: "Block reward", family: "mining", fold: true },
  "fee-collect": { ru: "Комиссии блока", en: "Block fees", family: "mining", fold: true },
  "miner-payout": { ru: "Выплата майнерам", en: "Miner payout", family: "mining" },
  rent: { ru: "Плата за хранение", en: "Storage rent", family: "mining" },
  "token-issue": { ru: "Выпуск токена", en: "Token issued", family: "token" },
  "nft-mint": { ru: "Выпуск NFT", en: "NFT minted", family: "token" },
  burn: { ru: "Сжигание", en: "Burn", family: "token" },
  "name-register": { ru: "Регистрация имени", en: "Name registered", family: "token" },
  swap: { ru: "Обмен", en: "Swap", family: "defi" },
  "order-place": { ru: "Заявка на обмен", en: "Swap order", family: "defi" },
  "order-cancel": { ru: "Отмена заявки", en: "Order cancelled", family: "defi" },
  "lp-add": { ru: "Вклад в пул", en: "Add liquidity", family: "defi" },
  "lp-remove": { ru: "Вывод из пула", en: "Remove liquidity", family: "defi" },
  "pool-create": { ru: "Новый пул", en: "Pool created", family: "defi" },
  "stable-mint": { ru: "Выпуск стейблкоина", en: "Stablecoin mint", family: "defi" },
  "stable-redeem": { ru: "Погашение стейблкоина", en: "Stablecoin redeem", family: "defi" },
  loan: { ru: "Заём", en: "Loan", family: "defi" },
  "loan-repay": { ru: "Погашение займа", en: "Loan repaid", family: "defi" },
  stake: { ru: "Депозит", en: "Deposit", family: "defi" },
  unstake: { ru: "Вывод депозита", en: "Withdrawal", family: "defi" },
  payout: { ru: "Выплата протокола", en: "Protocol payout", family: "defi" },
  auction: { ru: "Аукцион", en: "Auction", family: "defi" },
  "bridge-out": { ru: "Мост: отправка", en: "Bridge out", family: "bridge" },
  "bridge-in": { ru: "Мост: получение", en: "Bridge in", family: "bridge" },
  mix: { ru: "Микширование", en: "Mixing", family: "mixer" },
  "oracle-post": { ru: "Цена от оракула", en: "Oracle price post", family: "service", quiet: true, fold: true },
  "oracle-update": { ru: "Обновление курса", en: "Oracle update", family: "service", quiet: true, fold: true },
  service: { ru: "Служебная", en: "Protocol upkeep", family: "service", quiet: true, fold: true },
  "contract-call": { ru: "Вызов контракта", en: "Contract call", family: "unknown" },
  "to-contract": { ru: "Отправка в контракт", en: "Sent to contract", family: "unknown" },
};

export const MEANING_ACTION_IDS = Object.keys(MEANING_VOCAB) as MeaningActionId[];

export function meaningWord(id: MeaningActionId): MeaningWord {
  return MEANING_VOCAB[id];
}

/** The service family: oracle posts and updates, protocol upkeep (the `service` flag). */
export function isServiceAction(id: MeaningActionId): boolean {
  return MEANING_VOCAB[id].family === "service";
}

/**
 * Rows a busy list folds into «Служебные: N · показать»: the service family plus block rewards
 * and block fees. Machines make them every block; people rarely look for them.
 */
export function isFoldedAction(id: MeaningActionId): boolean {
  return MEANING_VOCAB[id].fold === true;
}
