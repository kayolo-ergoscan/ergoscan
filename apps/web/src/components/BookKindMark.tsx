import { KpiMark, type KpiMarkId } from "@/components/kpi-marks";
import type { BookDirectoryKind } from "@/lib/address-book";

export type BookTileId = "all" | BookDirectoryKind;

/** Address book tiles: the same concept icons as the address kinds on /addresses. */
const BOOK_MARK: Record<BookTileId, KpiMarkId> = {
  all: "name",
  wallet: "wallet",
  protocol: "protocol",
  exchange: "exchange",
  pool: "miner",
  contract: "contract",
};

export function BookKindMark({ id, className }: { id: BookTileId; className?: string }) {
  return <KpiMark id={BOOK_MARK[id] ?? "contract"} className={className} />;
}
