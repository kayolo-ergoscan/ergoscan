"use client";

import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { AddrFactCard } from "@/components/AddrFactCard";
import { KpiMark } from "@/components/kpi-marks";
import { INK, INK_TEXT } from "@/lib/palette";
import { useI18n } from "@/lib/i18n/I18nProvider";
import { useKeepFresh, usePageSync } from "@/lib/page-sync";

const ORIGIN = "https://api.ergoscan.me";
const ADDR = "9euJma7w75m5VThHmTeJAPY9YWxhKHGSe8aHgF1rBJH9156pjoZ";
const BOX = "6a50fa0add58fb4366484278657901b1be0f77d546b428bedcda2cd51791470c";
const TX = "81c900e58c5dab21603b225796d26c8dcbe61863e27e0076bb0582cb08d145b3";
const TOKEN = "e1d7fcb9c033970d8485c200efc9febbb17244639c17c57a4c14b76bbd559183";
const TEMPLATE = "3328cef917f9983ffcae8a3117fba409a7780c672bdfc09343245d3376f207fd";

type Loc = "en" | "ru";
type Method = "GET" | "POST";
type FieldIn = "path" | "query" | "body";

type Field = {
  name: string;
  in: FieldIn;
  value: string;
  hint: Record<Loc, string>;
  area?: boolean;
};

type Op = {
  id: string;
  group: string;
  method: Method;
  path: string;
  title: Record<Loc, string>;
  blurb: Record<Loc, string>;
  fields: Field[];
};

const GROUPS: { id: string; en: string; ru: string }[] = [
  { id: "chain", en: "Chain", ru: "Цепь" },
  { id: "boxes", en: "Boxes", ru: "Коробки" },
  { id: "addresses", en: "Addresses", ru: "Адреса" },
  { id: "tokens", en: "Tokens", ru: "Токены" },
  { id: "submit", en: "Submit", ru: "Отправка" },
  { id: "graphql", en: "GraphQL", ru: "GraphQL" },
];

const OPS: Op[] = [
  {
    id: "info",
    group: "chain",
    method: "GET",
    path: "/info",
    title: { en: "Node and height", ru: "Нода и высота" },
    blurb: { en: "Network, height, and the last block.", ru: "Сеть, высота и последний блок." },
    fields: [],
  },
  {
    id: "network",
    group: "chain",
    method: "GET",
    path: "/networkState",
    title: { en: "Network state", ru: "Состояние сети" },
    blurb: { en: "Height the index is serving.", ru: "Высота, которую отдаёт индекс." },
    fields: [],
  },
  {
    id: "epochs",
    group: "chain",
    method: "GET",
    path: "/epochs/params",
    title: { en: "Epoch parameters", ru: "Параметры эпохи" },
    blurb: { en: "Current protocol parameters.", ru: "Текущие параметры протокола." },
    fields: [],
  },
  {
    id: "headers",
    group: "chain",
    method: "GET",
    path: "/blocks/headers",
    title: { en: "Block headers", ru: "Заголовки блоков" },
    blurb: { en: "Newest headers. Follow nextCursor.", ru: "Свежие заголовки. Дальше по nextCursor." },
    fields: [
      { name: "limit", in: "query", value: "2", hint: { en: "1–50", ru: "1–50" } },
      { name: "cursor", in: "query", value: "", hint: { en: "height, optional", ru: "высота, необязательно" } },
    ],
  },
  {
    id: "unspent",
    group: "boxes",
    method: "GET",
    path: "/boxes/unspent/byAddress/{address}",
    title: { en: "Unspent by address", ru: "Непотраченные адреса" },
    blurb: { en: "Wallet UTXO. value is a decimal string.", ru: "UTXO кошелька. value — десятичная строка." },
    fields: [
      { name: "address", in: "path", value: ADDR, hint: { en: "address", ru: "адрес" } },
      { name: "limit", in: "query", value: "2", hint: { en: "1–100", ru: "1–100" } },
    ],
  },
  {
    id: "unconfirmed",
    group: "boxes",
    method: "GET",
    path: "/boxes/unspent/unconfirmed/byAddress/{address}",
    title: { en: "Unconfirmed boxes", ru: "Неподтверждённые коробки" },
    blurb: { en: "Outputs still in the mempool.", ru: "Выходы, которые ещё в мемпуле." },
    fields: [
      { name: "address", in: "path", value: ADDR, hint: { en: "address", ru: "адрес" } },
      { name: "limit", in: "query", value: "2", hint: { en: "1–100", ru: "1–100" } },
    ],
  },
  {
    id: "by-token",
    group: "boxes",
    method: "GET",
    path: "/boxes/unspent/byTokenId/{tokenId}",
    title: { en: "Unspent by token", ru: "Непотраченные по токену" },
    blurb: { en: "Boxes still holding this token.", ru: "Коробки, где токен ещё лежит." },
    fields: [
      { name: "tokenId", in: "path", value: TOKEN, hint: { en: "64 hex", ru: "64 hex" } },
      { name: "limit", in: "query", value: "2", hint: { en: "1–100", ru: "1–100" } },
    ],
  },
  {
    id: "search",
    group: "boxes",
    method: "POST",
    path: "/boxes/unspent/search",
    title: { en: "Search by template", ru: "Поиск по шаблону" },
    blurb: {
      en: "Body is ergoTreeTemplateHash only. limit 1–100, offset at most 500. Registers, constants, or a token list stay 501. hasMore, no total.",
      ru: "В теле только ergoTreeTemplateHash. limit 1–100, offset не больше 500. Регистры, константы или список токенов — 501. hasMore, без total.",
    },
    fields: [
      {
        name: "body",
        in: "body",
        area: true,
        value: `{\n  "ergoTreeTemplateHash": "${TEMPLATE}"\n}`,
        hint: { en: "64 hex SHA-256", ru: "64 hex SHA-256" },
      },
      { name: "limit", in: "query", value: "2", hint: { en: "1–100", ru: "1–100" } },
    ],
  },
  {
    id: "box",
    group: "boxes",
    method: "GET",
    path: "/boxes/{boxId}",
    title: { en: "Box by id", ru: "Коробка по id" },
    blurb: { en: "Explorer document. Amounts are strings.", ru: "Документ проводника. Суммы — строки." },
    fields: [{ name: "boxId", in: "path", value: BOX, hint: { en: "64 hex", ru: "64 hex" } }],
  },
  {
    id: "tx",
    group: "boxes",
    method: "GET",
    path: "/transactions/{txId}",
    title: { en: "Transaction by id", ru: "Транзакция по id" },
    blurb: { en: "Inputs, outputs, and a string value.", ru: "Входы, выходы и value строкой." },
    fields: [{ name: "txId", in: "path", value: TX, hint: { en: "64 hex", ru: "64 hex" } }],
  },
  {
    id: "bal-conf",
    group: "addresses",
    method: "GET",
    path: "/addresses/{address}/balance/confirmed",
    title: { en: "Confirmed balance", ru: "Подтверждённый баланс" },
    blurb: { en: "nanoErgs and token amounts as strings.", ru: "nanoErgs и количества токенов строками." },
    fields: [{ name: "address", in: "path", value: ADDR, hint: { en: "address", ru: "адрес" } }],
  },
  {
    id: "bal-total",
    group: "addresses",
    method: "GET",
    path: "/addresses/{address}/balance/total",
    title: { en: "Total balance", ru: "Полный баланс" },
    blurb: { en: "Confirmed plus what the mempool still holds.", ru: "Подтверждённое плюс то, что ещё в мемпуле." },
    fields: [{ name: "address", in: "path", value: ADDR, hint: { en: "address", ru: "адрес" } }],
  },
  {
    id: "addr-tx",
    group: "addresses",
    method: "GET",
    path: "/addresses/{address}/transactions",
    title: { en: "Address transactions", ru: "Транзакции адреса" },
    blurb: { en: "Newest first. Follow nextCursor.", ru: "Сначала новые. Дальше по nextCursor." },
    fields: [
      { name: "address", in: "path", value: ADDR, hint: { en: "address", ru: "адрес" } },
      { name: "limit", in: "query", value: "2", hint: { en: "1–100", ru: "1–100" } },
    ],
  },
  {
    id: "token",
    group: "tokens",
    method: "GET",
    path: "/tokens/{tokenId}",
    title: { en: "Token by id", ru: "Токен по id" },
    blurb: { en: "Name, decimals, emission as a string.", ru: "Имя, decimals, выпуск строкой." },
    fields: [{ name: "tokenId", in: "path", value: TOKEN, hint: { en: "64 hex", ru: "64 hex" } }],
  },
  {
    id: "symbol",
    group: "tokens",
    method: "GET",
    path: "/tokens/bySymbol/{symbol}",
    title: { en: "Tokens by symbol", ru: "Токены по символу" },
    blurb: { en: "Every token that carries this symbol.", ru: "Все токены с этим символом." },
    fields: [{ name: "symbol", in: "path", value: "SigUSD", hint: { en: "symbol", ru: "символ" } }],
  },
  {
    id: "submit",
    group: "submit",
    method: "POST",
    path: "/mempool/transactions/submit",
    title: { en: "Submit a transaction", ru: "Отправить транзакцию" },
    blurb: {
      en: "Broadcasts a signed transaction. An empty body is rejected before the node.",
      ru: "Отправляет подписанную транзакцию в сеть. Пустое тело отклоняется до ноды.",
    },
    fields: [
      {
        name: "body",
        in: "body",
        area: true,
        value: '{\n  "id": "",\n  "inputs": [],\n  "outputs": []\n}',
        hint: { en: "signed JSON", ru: "подписанный JSON" },
      },
    ],
  },
  {
    id: "gql",
    group: "graphql",
    method: "POST",
    path: "/graphql",
    title: { en: "Nautilus query", ru: "Запрос Nautilus" },
    blurb: {
      en: "POST /api/graphql. Version 0.5.5. Amounts are strings. Reads: 2000 per minute, separate from REST. An input's proofBytes is the spending proof as hex. An empty string means that input has no proof, or this height is not written yet. The website does not show it.",
      ru: "POST /api/graphql. Версия 0.5.5. Суммы — строки. Чтение: 2000 в минуту, отдельно от REST. proofBytes у входа — доказательство траты, hex. Пустая строка: пруфа нет или эта высота ещё не записана. На сайте это не показываем.",
    },
    fields: [
      {
        name: "query",
        in: "body",
        area: true,
        value:
          'query {\n  transactions(transactionIds: ["43828de77213479b27fe55f6a5d4551f411f23c8f17c289d48c7baa33c593b78"]) {\n    inputs { proofBytes }\n  }\n}',
        hint: { en: "GraphQL. proofBytes is hex.", ru: "GraphQL. proofBytes — hex." },
      },
    ],
  },
];

const HOLES = ["GET /boxes/unspent/stream", "GET /blocks/byGlobalIndex/stream"];

function say(locale: string, text: Record<Loc, string>): string {
  return locale === "ru" ? text.ru : text.en;
}

function buildUrl(op: Op, values: Record<string, string>): string {
  let path = op.path;
  const query = new URLSearchParams();
  for (const field of op.fields) {
    const raw = values[field.name] ?? "";
    if (field.in === "path") path = path.replace(`{${field.name}}`, encodeURIComponent(raw));
    else if (field.in === "query" && raw.trim()) query.set(field.name, raw.trim());
  }
  const root = op.group === "graphql" ? `${ORIGIN}/api` : `${ORIGIN}/api/v1`;
  const qs = query.toString();
  return `${root}${path}${qs ? `?${qs}` : ""}`;
}

export function ApiSite() {
  const { locale } = useI18n();
  const { markSynced } = usePageSync();
  useKeepFresh(() => markSynced());
  useEffect(() => {
    markSynced();
  }, [markSynced]);
  const loc = locale === "ru" ? "ru" : "en";
  const [group, setGroup] = useState("chain");
  const [opId, setOpId] = useState("info");
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const op of OPS) for (const field of op.fields) init[`${op.id}.${field.name}`] = field.value;
    return init;
  });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<number | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const op = OPS.find((item) => item.id === opId) ?? OPS[0]!;
  const visible = useMemo(() => OPS.filter((item) => item.group === group), [group]);

  const run = async (target: Op) => {
    const bag: Record<string, string> = {};
    for (const field of target.fields) bag[field.name] = values[`${target.id}.${field.name}`] ?? "";
    const url = buildUrl(target, bag);
    setBusy(true);
    setStatus(null);
    setBody("");
    const started = performance.now();
    try {
      const init: RequestInit = { cache: "no-store" };
      if (target.method === "POST") {
        const raw = bag.body ?? bag.query ?? "";
        if (target.id === "gql") {
          init.method = "POST";
          init.headers = { "content-type": "application/json" };
          init.body = JSON.stringify({ query: raw });
        } else {
          let parsed: unknown;
          try {
            parsed = JSON.parse(raw);
          } catch {
            setStatus(0);
            setMs(Math.round(performance.now() - started));
            setBody(loc === "ru" ? "Тело не JSON." : "Body is not JSON.");
            setBusy(false);
            return;
          }
          init.method = "POST";
          init.headers = { "content-type": "application/json" };
          init.body = JSON.stringify(parsed);
        }
      }
      const res = await fetch(url, init);
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        /* leave text */
      }
      if (pretty.length > 6000) pretty = `${pretty.slice(0, 6000)}\n…`;
      setStatus(res.status);
      setBody(pretty);
    } catch (err) {
      setStatus(0);
      setBody(String(err));
    } finally {
      setMs(Math.round(performance.now() - started));
      setBusy(false);
    }
  };

  useEffect(() => {
    void run(OPS[0]!);
    // Live height on first paint. Later calls are the button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pick = (next: Op) => {
    setGroup(next.group);
    setOpId(next.id);
    setBody("");
    setStatus(null);
    setMs(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <AddrFactCard className="min-h-0 h-auto" enter={0} label="Ergo mainnet" ink={INK.cyan} mark={<KpiMark id="api" />}>
        <h1 className="mt-0.5 text-[17px] font-semibold leading-none tracking-tight">API</h1>
        <p className="mt-1.5 max-w-3xl text-[12px] leading-snug text-[var(--muted-2)]">
          {loc === "ru"
            ? "Контракт кошелька. Те же пути, что у официального проводника, на этом хосте."
            : "Wallet contract. The same paths as the official explorer, on this host."}
        </p>
        <p className="mt-3 font-mono text-[13px] text-[var(--text)]">{ORIGIN}/api/v1</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {(loc === "ru"
            ? ["Без ключа", "CORS *", "REST 120 / мин", "GraphQL 2000 / мин", "Суммы — строки"]
            : ["No key", "CORS *", "REST 120 / min", "GraphQL 2000 / min", "Amounts are strings"]
          ).map((chip) => (
            <span
              key={chip}
              className="rounded-full bg-[var(--wash)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)]"
            >
              {chip}
            </span>
          ))}
        </div>
      </AddrFactCard>

      <div className="flex flex-wrap gap-1 rounded-[14px] bg-[var(--wash)] p-1">
        {GROUPS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              const first = OPS.find((row) => row.group === item.id);
              if (first) pick(first);
              else setGroup(item.id);
            }}
            className={clsx(
              "chip-press rounded-[10px] px-3 py-1.5 text-[12px] font-medium sm:text-[13px]",
              group === item.id
                ? "seg-on is-pressed bg-[var(--wash-strong)] text-[var(--text)]"
                : "text-[var(--muted)] hover:text-[var(--text)]"
            )}
          >
            {loc === "ru" ? item.ru : item.en}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-2 lg:grid-cols-[minmax(16rem,0.85fr)_minmax(0,1.25fr)]">
        <div className="flex min-w-0 flex-col gap-1">
          {visible.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pick(item)}
              className={clsx(
                "chip-press flex min-w-0 items-center gap-2 rounded-[14px] px-3 py-2.5 text-left",
                item.id === op.id ? "bg-[var(--wash-strong)]" : "bg-[var(--wash-faint)] hover:bg-[var(--wash)]"
              )}
            >
              <Method method={item.method} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-[var(--text)]">{say(loc, item.title)}</span>
                <span className="mt-0.5 block truncate font-mono text-[11px] text-[var(--muted)]">{item.path}</span>
              </span>
            </button>
          ))}
        </div>

        <section className="mod min-w-0 rounded-[20px] border border-[var(--border)] bg-[var(--module)] px-4 py-4">
          <div className="flex min-w-0 items-center gap-2">
            <Method method={op.method} />
            <h2 className="min-w-0 truncate text-[15px] font-semibold text-[var(--text)]">{say(loc, op.title)}</h2>
          </div>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--muted)]">{say(loc, op.blurb)}</p>
          <p className="mt-3 break-all font-mono text-[12px] leading-relaxed text-[var(--accent)]">
            {buildUrl(op, Object.fromEntries(op.fields.map((field) => [field.name, values[`${op.id}.${field.name}`] ?? ""])))}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {op.fields.map((field) => (
              <label key={field.name} className="block min-w-0">
                <span className="text-[11px] font-medium text-[var(--muted)]">
                  {field.name}
                  <span className="ml-2 font-normal text-[var(--muted-2)]">{say(loc, field.hint)}</span>
                </span>
                {field.area ? (
                  <textarea
                    value={values[`${op.id}.${field.name}`] ?? ""}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [`${op.id}.${field.name}`]: event.target.value }))
                    }
                    spellCheck={false}
                    rows={field.name === "body" ? 8 : 4}
                    className="mt-1 w-full resize-y rounded-[12px] bg-[var(--wash)] px-3 py-2 font-mono text-[12px] leading-relaxed text-[var(--text)] outline-none"
                  />
                ) : (
                  <input
                    value={values[`${op.id}.${field.name}`] ?? ""}
                    onChange={(event) =>
                      setValues((prev) => ({ ...prev, [`${op.id}.${field.name}`]: event.target.value }))
                    }
                    spellCheck={false}
                    className="mt-1 w-full rounded-[12px] bg-[var(--wash)] px-3 py-2 font-mono text-[12px] text-[var(--text)] outline-none"
                  />
                )}
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void run(op)}
              className="chip-press rounded-[10px] bg-[var(--wash-strong)] px-3 py-1.5 text-[13px] font-medium text-[var(--text)] disabled:opacity-60"
            >
              {busy ? (loc === "ru" ? "Запрос…" : "Request…") : loc === "ru" ? "Запросить" : "Try"}
            </button>
            {status != null && (
              <span
                className="font-mono text-[12px]"
                style={{ color: status >= 200 && status < 300 ? INK_TEXT.green : INK_TEXT.gold }}
              >
                {status || "—"}
                {ms != null ? ` · ${ms} ms` : ""}
              </span>
            )}
          </div>
          {body && (
            <pre className="mt-3 max-h-80 overflow-auto rounded-[14px] bg-[var(--wash)] px-3 py-3 font-mono text-[12px] leading-relaxed text-[var(--text)]">
              {body}
            </pre>
          )}
        </section>
      </div>

      <section className="rounded-[20px] bg-[var(--wash-faint)] px-4 py-3">
        <p className="text-[12px] leading-relaxed text-[var(--muted)]">
          {loc === "ru"
            ? "Эти пути отвечают 501. Поиск по шаблону уже открыт. Предикат по регистрам и поток всей цепи остаются закрыты."
            : "These paths return 501. Template search is open. Register predicates and a full-chain stream stay closed."}
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {HOLES.map((path) => (
            <li key={path} className="font-mono text-[11px] text-[var(--muted-2)]">
              {path}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Method({ method }: { method: Method }) {
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center rounded-[6px] px-1.5 font-mono text-[10px] font-semibold tracking-wide"
      style={{
        color: method === "GET" ? INK_TEXT.teal : INK_TEXT.gold,
        background: method === "GET" ? "color-mix(in srgb, var(--api-get) 16%, transparent)" : "color-mix(in srgb, var(--api-post) 16%, transparent)",
      }}
    >
      {method}
    </span>
  );
}

