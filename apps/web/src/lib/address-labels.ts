import { roleByTemplate } from "@ergoscan/shared";
import { shortId } from "./format";
import {
  isFeeAddress,
  isLiveCexAddress,
  lookupAddress,
  type BookEntry,
  type BookKind,
} from "./address-book";

export type PartyKind = BookKind;

export {
  ADDRESS_BOOK,
  BOOK_DIRECTORY_KINDS,
  FEE_CONTRACT,
  countBookKinds,
  directoryKind,
  isFeeAddress,
  isLiveCexAddress,
  isRejectedCex,
  listBookEntries,
  lookupAddress,
  searchAddressBook,
} from "./address-book";
export type { BookDirectoryKind, BookKindCounts } from "./address-book";

/** Same CASE as indexer `holder_bands`: prefix `9` and length < 70. */
export function isP2pkAddress(address: string | null | undefined): boolean {
  if (!address) return false;
  return address.startsWith("9") && address.length < 70;
}

/**
 * What the page knows about the script at an address besides the book. One address is one
 * ErgoTree, so a template hash seen on any of its boxes names the address.
 */
export type ContractHint = {
  /** ErgoTree template hash of a box at the address (gateway `templateHash` / `ergoTreeTemplateHash`). */
  templateHash?: string | null;
  /** A contract name the gateway already looked up (list rows). */
  name?: string | null;
};

/**
 * The contract registry's name (the labels the tx meaning shows, roleByTemplate) for an address
 * the book does not name: orders and positions have one address each. A guess is not a name.
 */
export function contractName(hint: ContractHint | null | undefined): string | null {
  if (!hint) return null;
  const given = hint.name?.trim();
  if (given) return given;
  const role = roleByTemplate(hint.templateHash);
  return role && role.src !== "guess" ? role.label : null;
}

export function describeParty(
  address: string | null | undefined,
  isFee = false,
  hint?: ContractHint | null
): {
  kind: PartyKind;
  known: string | null;
  short: string | null;
  book: BookEntry | null;
} {
  const book = lookupAddress(address);
  const fee = isFee || isFeeAddress(address);
  const short = address ? shortId(address, 6) : null;
  if (fee) {
    return {
      kind: "miner",
      known: book && book.kind !== "miner" ? book.name : null,
      short,
      book,
    };
  }
  if (!address) return { kind: "unknown", known: null, short: null, book: null };
  if (book?.kind === "protocol") {
    return { kind: "protocol", known: book.name, short, book };
  }
  if (isLiveCexAddress(address)) {
    return { kind: "exchange", known: book?.name ?? null, short, book };
  }
  if (address.startsWith("88") || book?.kind === "pool") {
    return { kind: "pool", known: book?.name ?? null, short, book };
  }
  if (book) {
    const kind = book.kind === "exchange" ? "wallet" : book.kind;
    return { kind, known: book.name, short, book };
  }
  if (isP2pkAddress(address)) {
    return { kind: "wallet", known: null, short: shortId(address, 5), book: null };
  }
  // A book name always wins; the registry only names a contract the book leaves bare.
  return { kind: "contract", known: contractName(hint), short, book: null };
}
