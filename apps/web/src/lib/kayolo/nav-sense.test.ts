import assert from "node:assert/strict";
import { test } from "node:test";
import { clickKind, createTrail, type ClickInput, type Here } from "./nav-sense";

const here: Here = { origin: "https://ergoscan.me", path: "/block/1915898", search: "", hash: "" };

const click = (href: string | null, over: Partial<ClickInput> = {}): ClickInput => ({
  button: 0,
  ctrl: false,
  meta: false,
  shift: false,
  alt: false,
  prevented: false,
  href,
  target: null,
  download: false,
  ...over,
});

test("a link to another page is `go`; the same URL is `here`", () => {
  assert.equal(clickKind(click("/blocks"), here), "go");
  assert.equal(clickKind(click("/block/1915898?x=1"), here), "go");
  assert.equal(clickKind(click("/block/1915898"), here), "here");
  assert.equal(clickKind(click("/block/1915898/"), here), "here");
  assert.equal(clickKind(click("https://ergoscan.me/block/1915898"), here), "here");
});

test("Ctrl, Cmd, Shift, the middle button and target=_blank are `aside`", () => {
  assert.equal(clickKind(click("/blocks", { ctrl: true }), here), "aside");
  assert.equal(clickKind(click("/blocks", { meta: true }), here), "aside");
  assert.equal(clickKind(click("/blocks", { shift: true }), here), "aside");
  assert.equal(clickKind(click("/blocks", { button: 1 }), here), "aside");
  assert.equal(clickKind(click("/blocks", { target: "_blank" }), here), "aside");
  // The current URL in a new tab is still a new tab.
  assert.equal(clickKind(click("/block/1915898", { button: 1 }), here), "aside");
  // External links opened aside, too.
  assert.equal(clickKind(click("https://github.com/ergoplatform", { target: "_blank" }), here), "aside");
});

test("nothing to answer: hash jumps, alt, downloads, mailto, plain external, right button, prevented", () => {
  assert.equal(clickKind(click("#tokens"), here), null);
  assert.equal(clickKind(click("/block/1915898#header"), here), null);
  assert.equal(clickKind(click("/blocks", { alt: true }), here), null);
  assert.equal(clickKind(click("/blocks", { download: true }), here), null);
  assert.equal(clickKind(click("mailto:x@y.z"), here), null);
  assert.equal(clickKind(click("https://github.com/ergoplatform"), here), null);
  assert.equal(clickKind(click("/blocks", { button: 2 }), here), null);
  assert.equal(clickKind(click("/blocks", { prevented: true }), here), null);
  assert.equal(clickKind(click(null), here), null);
});

test("the same URL with its own hash again is «already here»", () => {
  const h = { ...here, hash: "#header" };
  assert.equal(clickKind(click("/block/1915898#header"), h), "here");
});

test("trail: Back and Forward along pushes, seen pages", () => {
  const t = createTrail("/a");
  t.push("/b");
  t.push("/c");
  assert.deepEqual(t.pop("/b"), { dir: -1, seen: true });
  assert.deepEqual(t.pop("/a"), { dir: -1, seen: true });
  assert.deepEqual(t.pop("/b"), { dir: 1, seen: true });
  assert.equal(t.current(), "/b");
  // A push from the middle cuts the forward part.
  t.push("/d");
  assert.deepEqual(t.pop("/b"), { dir: -1, seen: true });
  assert.deepEqual(t.pop("/d"), { dir: 1, seen: true });
});

test("trail: a pop that stays on the URL (a sheet's entry, a hash) is nothing", () => {
  const t = createTrail("/a");
  t.push("/b");
  assert.equal(t.pop("/b"), null);
  t.push("/b");
  assert.equal(t.current(), "/b");
});

test("trail: a jump of two entries finds the side; an unknown URL is Back and not seen", () => {
  const t = createTrail("/a");
  t.push("/b");
  t.push("/c");
  t.push("/d");
  assert.deepEqual(t.pop("/b"), { dir: -1, seen: true });
  assert.deepEqual(t.pop("/d"), { dir: 1, seen: true });
  assert.deepEqual(t.pop("/elsewhere"), { dir: -1, seen: false });
  assert.equal(t.current(), "/elsewhere");
});
