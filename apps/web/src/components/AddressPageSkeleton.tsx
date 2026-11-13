export function AddressPageSkeleton() {
  return (
    <div>
      <div className="addr-facts" aria-busy="true" aria-live="polite">
        <p className="sr-only">Loading</p>
        <div className="addr-lane">
          <div className="col-span-2 flex min-h-0 flex-col gap-2 lg:col-span-1 lg:row-span-2">
            <div className="h-[72px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
            <div className="h-[38px] animate-pulse rounded-[14px] bg-[var(--wash)] max-lg:hidden" />
          </div>
          <div className="col-span-2 h-[72px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)] lg:col-span-1 lg:row-span-2" />
          <div className="addr-facts-stat h-[56px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
          <div className="addr-facts-stat h-[56px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
          <div className="addr-facts-stat h-[56px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
          <div className="addr-facts-stat h-[56px] animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
        </div>
        <div className="addr-facts-qr animate-pulse rounded-[20px] border border-[var(--border)] bg-[var(--module)]" />
      </div>
      {/* Phone: the tab strip sits under the tiles (DetailTabs). */}
      <div className="mt-3 h-12 animate-pulse rounded-[14px] bg-[var(--wash)] lg:hidden" aria-hidden />
      <div className="addr-sheet mt-2" aria-hidden>
        <div className="h-9 animate-pulse rounded-[14px] bg-[var(--wash)]" />
        {Array.from({ length: 8 }, (_, i) => (
          <div
            key={i}
            className="mt-2 h-10 animate-pulse rounded-[12px] bg-[var(--wash-faint)]"
          />
        ))}
      </div>
    </div>
  );
}
