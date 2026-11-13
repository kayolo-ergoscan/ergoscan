import { say } from "@/lib/kayolo/events";

/**
 * `navigator.clipboard.writeText` that also tells Kayolo (design/brand/kayolo-life.md §6.2): a nod
 * toward the copied thing, a shrug when the clipboard refuses. Same contract as the call it
 * replaces: undefined without the async clipboard, else its promise (it rejects as before).
 */
export function copyText(text: string): Promise<void> | undefined {
  const from = typeof document === "undefined" ? null : document.activeElement;
  const cb = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (!cb?.writeText) {
    say({ k: "ui:copy-fail", el: from });
    return undefined;
  }
  const p = cb.writeText(text);
  p.then(
    () => say({ k: "ui:copy", el: from }),
    () => say({ k: "ui:copy-fail", el: from })
  );
  return p;
}
