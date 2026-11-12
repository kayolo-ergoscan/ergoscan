/**
 * JSON-LD goes into a raw <script>. Names in it come from the chain (anyone can mint a token
 * called `</script><script>…`), so every character that can end the script or open markup is
 * written as a JSON escape. The value parses back to the same JSON.
 */
export function jsonLdText(data: Record<string, unknown>): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: jsonLdText(data) }}
    />
  );
}
