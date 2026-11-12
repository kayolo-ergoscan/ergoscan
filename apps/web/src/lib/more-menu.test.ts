import assert from "node:assert/strict";
import { test } from "node:test";
import { NAV_FOOT, NAV_MAIN, type NavItem } from "./nav-tree";
import { MOBILE_TABS } from "./mobile-tab";
import { MORE_FOOT, MORE_GROUPS, moreDestinations, moreLinkActive } from "./more-menu";

function railHrefs(items: readonly NavItem[]): string[] {
  return items.flatMap((i) => [i.href, ...railHrefs(i.children ?? [])]);
}

test("every page the rail reaches is reachable on a phone", () => {
  const phone = new Set([...MOBILE_TABS.map((t) => t.href), ...moreDestinations()]);
  const missing = [...new Set(railHrefs([...NAV_MAIN, ...NAV_FOOT]))].filter((h) => !phone.has(h));
  assert.deepEqual(missing, []);
});

test("the sheet does not repeat the four tabs", () => {
  const tabs = new Set(MOBILE_TABS.map((t) => t.href));
  const tiles = MORE_GROUPS.flatMap((g) => g.tiles.map((t) => t.href));
  assert.deepEqual(tiles.filter((h) => tabs.has(h)), []);
  assert.deepEqual(MORE_FOOT.map((f) => f.href), ["/about", "/settings"]);
});

test("groups: explore, protocols, tools in a 3-column grid", () => {
  assert.deepEqual(MORE_GROUPS.map((g) => g.key), ["more.explore", "more.protocols", "more.tools"]);
  assert.deepEqual(
    MORE_GROUPS[1].tiles.filter((t) => t.step).map((t) => t.href),
    ["/defi", "/oracles", "/rent"]
  );
});

test("active tile follows the section, steps are exact", () => {
  const defi = MORE_GROUPS[1].tiles[0];
  assert.equal(moreLinkActive("/defi/pool/abc", defi), true);
  assert.equal(moreLinkActive("/address/9abc", MORE_GROUPS[0].tiles[0]), true);
  const dex = defi.step![0];
  assert.equal(moreLinkActive("/defi", dex), true);
  assert.equal(moreLinkActive("/defi/lithos", dex), false);
  const api = MORE_GROUPS[2].tiles.find((t) => t.external)!;
  assert.equal(moreLinkActive("/", api), false);
});
