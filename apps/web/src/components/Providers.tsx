"use client";

import { Suspense } from "react";
import { SkinSwitch } from "@/components/SkinSwitch";
import { TipHost } from "@/components/Tip";
import { I18nProvider } from "@/lib/i18n/I18nProvider";
import { PageSyncProvider } from "@/lib/page-sync";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <PageSyncProvider>
        <Suspense fallback={null}>
          <SkinSwitch />
        </Suspense>
        {children}
        <TipHost />
      </PageSyncProvider>
    </I18nProvider>
  );
}
