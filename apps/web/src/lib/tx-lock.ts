import { pickTxLock, type ShapeBox } from "@ergoscan/shared";

/** Translate a lock family or monetary protocol id. Unknown ids pass through. */
export function lockCaption(
  id: string | null | undefined,
  t: (k: string) => string
): string | null {
  if (!id) return null;
  for (const key of [`tx.lock.${id}`, `tx.protocol.${id}`]) {
    const loc = t(key);
    if (loc !== key) return loc;
  }
  return id;
}

export function actionCaption(
  id: string | null | undefined,
  t: (k: string) => string
): string | null {
  if (!id) return null;
  const key = `tx.action.${id}`;
  const loc = t(key);
  return loc !== key ? loc : null;
}

/** Shape, then the template action, otherwise the coarser lock name. */
export function txChipCaption(
  category: string,
  platform: string | null | undefined,
  action: string | null | undefined,
  t: (k: string) => string
): string {
  const catKey = `tx.cat.${category || "unknown"}`;
  const catLoc = t(catKey);
  const cat = catLoc !== catKey ? catLoc : category || t("tx.cat.unknown");
  const named = actionCaption(action, t) ?? lockCaption(platform, t);
  if (named && named !== cat) return `${cat} · ${named}`;
  return cat;
}

export function lockIdFromIo(
  inputs: ShapeBox[],
  outputs: ShapeBox[],
  dataInputs?: ShapeBox[]
): string | null {
  return pickTxLock({ inputs, outputs, dataInputs })?.id ?? null;
}
