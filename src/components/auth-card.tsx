import * as React from "react";

/**
 * Auth shell: a soft gradient stage with two cards stacked behind the real one,
 * so the form reads as the top of a deck rather than a flat panel.
 */
export function AuthStage({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-10">
      {/* backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-indigo-50 via-white to-amber-50 dark:from-slate-950 dark:via-slate-950 dark:to-indigo-950/40"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -left-24 top-1/4 h-72 w-72 rounded-full bg-indigo-300/25 blur-3xl dark:bg-indigo-600/10"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 bottom-1/4 h-72 w-72 rounded-full bg-amber-300/25 blur-3xl dark:bg-indigo-500/10"
      />
      <div className="relative w-full max-w-md">{children}</div>
    </main>
  );
}

export function StackedCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="relative">
      {/* the two cards peeking out behind */}
      <div
        aria-hidden
        className="absolute inset-x-6 -bottom-3 h-24 rounded-2xl border border-slate-200/70 bg-white/60 shadow-sm dark:border-slate-800 dark:bg-slate-900/50"
      />
      <div
        aria-hidden
        className="absolute inset-x-3 -bottom-1.5 h-24 rounded-2xl border border-slate-200/80 bg-white/80 shadow-sm dark:border-slate-800 dark:bg-slate-900/70"
      />
      <div
        className={`relative rounded-2xl border border-slate-200 bg-white/95 p-8 shadow-xl shadow-slate-900/5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-black/30 ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
