import assert from "node:assert/strict";
import { test } from "node:test";
import { PROTOCOL_NAMES, roleByTemplate } from "@ergoscan/shared";
import {
  contractNameByTemplate,
  contractNamesOf,
  nameFromRow,
  partyNames,
  registryFileUrl,
  templateTreeOf,
  type AddressName,
} from "./names.js";

/** A CL position box address seen in tx 8e879e7a… (template 64607fe0…). */
const V3_POSITION =
  "GqstHLPL2iea7Fhr8D8xAFuJtenqj38A1CgGQ5GpKfxDRDMMC5wtM6C2vG8KuzNvnsMFXfV2Ytt8MA9BFNSwBF47hkiTU16SjDotov7Pu6PQe5viVKPdxYRnvJtjRqfW1bwZovWGVgZSG67bC1dkfaVZLjKJuSJMA4H2fPNAGS5FUDHu4hxH934izCA76VcEFJryXJAKbQ18GQ9GHLu24orm9rXpQ6zrLNd9kuA3i46bQajAHWuEB7EMd5Dc18c6bYjrKYE2QGm4tQFFTE44aHH5p88NJCwbZST4tDjAZk2ECpF366taDZMGxo1xHj5yH2i1W8UbfQ8cWB7jwAgKUeri5A12F7XYn215byXGdcf4X1rLrsau7akAo6YVvBTfWe6a7PvFQPzBJEVKQAbLB8tWdqCnjrtcWmP91Nqmu2SK5cWRUL5hQym4CAKa11m4UGgQfTne9CoECrKx17XUWawFjmTdmoFjoC5kEeqVkUcX8eJdiiFfW364goyCnZwDYkfXWysrFSTjhvXXvWeZw8LM5W7ZbAFr38gpuz2PfYhZSM9fw4Qag1wFHEiE8QzS8A2EE";
const WALLET = "9h8yx5e4s22UaVyuY4r77vkbav4ieZ9BCjo2BTdKAWKvaQmMKsi";

test("a wallet never gets a template name, a P2S does", () => {
  assert.equal(templateTreeOf("9hFmeUHVttZmgtq4DEosEzJb3bTjx9HMJVptmMgfaHH9tYyGYTE"), null);
  const p2s =
    "2iHkR7CWvD1R4j1yZg5bkeDRQavjAaVPeTDFGGLZduHyfWMuYpmhHocX8GJoaieTx78FntzJbCBVL6rf96ocJoZdmWBL2fci7NqWgAirppPQmZ7fN9V6z13Ay6brPriBKYqLp1bT2Fk4FkFLCfdPpe";
  assert.match(templateTreeOf(p2s) ?? "", /^1005/);
});

test("registry rows keep provenance and link to the project file", () => {
  const n = nameFromRow({
    name: "XAU/ERG Oracle Refresh (2023)",
    kind: "contract",
    project_id: "oracle-pools",
    project_name: "Oracle pools",
    category: "oracle",
    by_whom: "ergoscan",
    via: "token",
    current: false,
    until_height: null,
    file: "oracle-pools.json",
  });
  assert.equal(n.via, "token");
  assert.equal(n.current, false);
  assert.equal(n.by, "ergoscan");
  assert.equal(n.fileUrl, registryFileUrl("oracle-pools.json"));
  assert.match(n.fileUrl, /^https:\/\/github\.com\/kayolo-ergoscan\/ergo-names\/blob\/main\/projects\/oracle-pools\.json$/);
  assert.equal(n.source, "ergo-names");
});

// Contract registry fallback. Labels are read from the registry, never copied into a test.
const V3_TPL = "64607fe0fe3c0e5fd7c41ca1f1d65e48270da2f98e9a17049bfb2172356b5b5f";
const LIMIT_V3_TPL = "cb3087cb229ef0ff020553ecf398908cff6de06cb21888a7cfc4565060ff4acd";
const CP_T2T_TPL = "d685202ad30554f9a0b0b32b0b3cab866f8786a14f87b91b1fbfbab422674d0c";
const GRID_N2T_TPL = "a68900b67ff5d74f74e7907aca83680adfc8ba01c1925430339d9e4c3f5dd0a3";
const GUESS_TPL = "db697243c2c862454a4be4c7cebf5cdb75a9d360e9297cb1543acfb0a32c5bd0";

test("a template the contract registry knows is a contract name without a book file", () => {
  for (const hash of [V3_TPL, LIMIT_V3_TPL, CP_T2T_TPL, GRID_N2T_TPL]) {
    const role = roleByTemplate(hash)!;
    const n = contractNameByTemplate(hash.toUpperCase())!;
    assert.equal(n.name, role.label);
    assert.equal(n.kind, "contract");
    assert.equal(n.via, "template");
    assert.equal(n.by, "ergoscan");
    assert.equal(n.source, "contracts");
    assert.equal(n.fileUrl, "");
    assert.equal(n.project.id, role.p);
    assert.equal(n.project.name, PROTOCOL_NAMES[role.p].en);
  }
});

test("a guess, an unknown template and no template are not names", () => {
  assert.equal(roleByTemplate(GUESS_TPL)?.src, "guess");
  assert.equal(contractNameByTemplate(GUESS_TPL), null);
  assert.equal(contractNameByTemplate("00".repeat(32)), null);
  assert.equal(contractNameByTemplate(null), null);
  assert.equal(contractNameByTemplate(""), null);
});

test("contractNamesOf names a position by its tree and leaves wallets out", async () => {
  const names = await contractNamesOf([V3_POSITION, WALLET, V3_POSITION, ""]);
  assert.equal(names.size, 1);
  assert.equal(names.get(V3_POSITION)?.name, roleByTemplate(V3_TPL)!.label);
  assert.equal(names.has(WALLET), false);
  assert.equal((await contractNamesOf([])).size, 0);
});

test("party names line up with from / to and are left out when none is named", () => {
  const n = contractNameByTemplate(V3_TPL)!;
  const names = new Map<string, AddressName>([["P", n]]);
  assert.deepEqual(partyNames({ from: ["W", "P"], to: ["W"] }, names), { fromNames: [null, n.name] });
  assert.deepEqual(partyNames({ from: [], to: ["P"] }, names), { toNames: [n.name] });
  assert.deepEqual(partyNames({ from: ["W"], to: ["W"] }, names), {});
});
