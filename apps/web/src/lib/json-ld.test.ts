import assert from "node:assert/strict";
import { test } from "node:test";
import { jsonLdText } from "../components/JsonLd";

test("a chain name cannot close the JSON-LD script", () => {
  const name = "NEET</script><script>alert(1)</script>&\u2028\u2029";
  const text = jsonLdText({ "@type": "WebPage", name });
  assert.ok(!text.includes("<"), text);
  assert.ok(!text.includes(">"), text);
  assert.ok(!text.includes("&"), text);
  assert.ok(!text.includes("\u2028") && !text.includes("\u2029"), text);
  assert.deepEqual(JSON.parse(text), { "@type": "WebPage", name });
});
