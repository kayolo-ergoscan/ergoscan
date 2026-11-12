import type { Metadata } from "next";
import { JsonLd } from "@/components/JsonLd";
import { matchBlockRow } from "@/lib/block-list-cache";
import { BLOCK_TX_PACK, fetchBlocksList } from "@/lib/list-snapshots";
import { blockPageMeta, cachedBlock, webpageJsonLd } from "@/lib/page-meta";
import { BlockView } from "./block-view";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const key = decodeURIComponent(id ?? "");
  return blockPageMeta(key, await cachedBlock(key));
}

export default async function BlockPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const key = decodeURIComponent(id ?? "");
  const list = await fetchBlocksList();
  const initialRow = list.find((row) => matchBlockRow(row, key)) ?? null;
  const olderRow =
    initialRow != null
      ? list.find((row) => row.height === initialRow.height - 1) ?? null
      : null;
  const newerRow =
    initialRow != null
      ? list.find((row) => row.height === initialRow.height + 1) ?? null
      : null;
  const card = await cachedBlock(key);
  const meta = blockPageMeta(key, card);
  return (
    <>
      <JsonLd
        data={webpageJsonLd({
          title: String(meta.title ?? "Block"),
          path: `/block/${key}`,
          description: String(meta.description ?? ""),
        })}
      />
      <BlockView
        key={key}
        id={key}
        initialRow={initialRow}
        olderRow={olderRow}
        newerRow={newerRow}
        initialHeader={card?.header ?? null}
        initialLithos={card?.lithos === true}
        initialTxs={card ? card.txs.slice(0, BLOCK_TX_PACK) : []}
      />
    </>
  );
}
