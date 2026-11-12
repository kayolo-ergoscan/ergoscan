import assert from "node:assert/strict";
import { test } from "node:test";
import { en } from "./i18n/en";
import { ru } from "./i18n/ru";

test("English and Russian dictionaries expose the same keys", () => {
  assert.deepEqual(
    Object.keys(en).sort(),
    Object.keys(ru).sort()
  );
});

test("plural forms: English one|other, Russian one|few|many", async () => {
  const { pluralForm, countText } = await import("./i18n/messages");
  const en2 = "{n} box|{n} boxes";
  assert.equal(pluralForm("en", en2, 1), "{n} box");
  assert.equal(pluralForm("en", en2, 0), "{n} boxes");
  assert.equal(pluralForm("en", en2, 2), "{n} boxes");
  const ru3 = "бокс|бокса|боксов";
  for (const n of [1, 21, 101]) assert.equal(pluralForm("ru", ru3, n), "бокс", String(n));
  for (const n of [2, 3, 4, 22, 104]) assert.equal(pluralForm("ru", ru3, n), "бокса", String(n));
  for (const n of [0, 5, 11, 12, 14, 25, 111]) assert.equal(pluralForm("ru", ru3, n), "боксов", String(n));
  assert.equal(pluralForm("ru", ru3, Number.NaN), "боксов");
  assert.equal(pluralForm("ru", "дн.", 5), "дн.");
  const t = (k: string) => (k === "x" ? "{n} транзакция|{n} транзакции|{n} транзакций" : k);
  assert.equal(countText(t, "ru-RU", "x", 1234, "1 234"), "1 234 транзакции");
});

test("count strings carry 2 forms in English and 3 in Russian", () => {
  for (const [k, v] of Object.entries(en)) {
    const n = String(v).split("|").length;
    assert.ok(n === 1 || n === 2, `en ${k}`);
  }
  for (const [k, v] of Object.entries(ru)) {
    const n = String(v).split("|").length;
    assert.ok(n === 1 || n === 3, `ru ${k}`);
  }
});
