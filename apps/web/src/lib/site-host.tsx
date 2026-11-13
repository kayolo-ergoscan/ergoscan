"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const SiteHostContext = createContext({ api: false });

/** In an effect: on api.ergoscan.me now. Child effects run before the provider's own, so the
 *  context still says false in a child's first effect. */
export function onApiHost(): boolean {
  return typeof window !== "undefined" && window.location.hostname === "api.ergoscan.me";
}

/** False during SSR, then true on api.ergoscan.me. Keeps the explorer's static HTML. */
export function SiteHostProvider({ children }: { children: ReactNode }) {
  const [api, setApi] = useState(false);
  useEffect(() => {
    setApi(onApiHost());
  }, []);
  return <SiteHostContext.Provider value={{ api }}>{children}</SiteHostContext.Provider>;
}

export function useSiteHost() {
  return useContext(SiteHostContext);
}

/** On the API host, explorer pages live on ergoscan.me. `/` stays the API home. */
export function explorerHref(href: string, api: boolean): string {
  if (href.startsWith("http")) return href;
  if (api && href !== "/") return `https://ergoscan.me${href}`;
  return href;
}
