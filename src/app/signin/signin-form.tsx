"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { AlertCircle, Eye, EyeOff, HelpCircle, Loader2, LogIn } from "lucide-react";
import { Button } from "@/components/ui";
import { Mascot } from "@/components/mascot";

/**
 * Shared credentials form. The labels differ between the student door
 * (/signin) and the staff door (/staff) so neither audience sees the other's
 * terminology.
 */
export function SignInForm({
  label,
  placeholder,
  hint,
  ambiguousHint,
  suggest = true,
  forgotHint,
  active = true,
}: {
  label: string;
  placeholder: string;
  hint?: string;
  ambiguousHint: string;
  /** Staff IDs should not be remembered or offered by the browser. */
  suggest?: boolean;
  /** Who to contact for a reset — differs for students and staff. */
  forgotHint: string;
  /** False when this face is flipped away: keep it out of the tab order. */
  active?: boolean;
}) {
  const router = useRouter();
  const [loginId, setLoginId] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [reveal, setReveal] = React.useState(false);
  const [showForgot, setShowForgot] = React.useState(false);
  const [pwFocused, setPwFocused] = React.useState(false);
  const [success, setSuccess] = React.useState(false);
  const idRef = React.useRef<HTMLInputElement>(null);
  const pwRef = React.useRef<HTMLInputElement>(null);

  // Eyes track roughly where the caret sits in the ID field.
  const look = React.useMemo(() => {
    const el = idRef.current;
    const max = 26; // characters before the gaze is fully to the right
    const caret = el?.selectionStart ?? loginId.length;
    return Math.min(caret, max) / max;
  }, [loginId]);

  // Stay covered while a password is present, not merely while focused —
  // otherwise clicking the eye blurs the field and the hands drop.
  const guarding = pwFocused || password.length > 0;
  const covering = guarding && !reveal;
  const peeking = guarding && reveal;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);

    const res = await signIn("credentials", { loginId, password, redirect: false });

    if (res?.error) {
      setError(/AmbiguousName/i.test(res.error) ? ambiguousHint : "Incorrect ID or password.");
      setBusy(false);
      return;
    }
    setSuccess(true);
    router.push("/");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-4" inert={!active || undefined}>
      <div className="-mt-2 mb-2">
        <Mascot look={look} covering={covering} peeking={peeking} celebrating={success} />
      </div>
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
          {label}
        </span>
        <input
          ref={idRef}
          value={loginId}
          onChange={(e) => setLoginId(e.target.value)}
          autoComplete={suggest ? "username" : "off"}
          autoCorrect="off"
          spellCheck={false}
          autoCapitalize="none"
          placeholder={placeholder}
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900"
        />
        {hint ? (
          <span className="mt-1.5 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>
        ) : null}
      </label>

      <div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-600 dark:text-slate-300">
            Password
          </span>
          <span className="relative block">
            <input
              ref={pwRef}
              type={reveal ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onFocus={() => setPwFocused(true)}
              onBlur={() => setPwFocused(false)}
              autoComplete="current-password"
              required
              className="w-full rounded-lg border border-slate-300 py-2 pl-3 pr-11 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 dark:border-slate-700 dark:bg-slate-900"
            />
            <button
              type="button"
              onClick={() => {
                setReveal((v) => !v);
                // Send the caret straight back to the field.
                requestAnimationFrame(() => pwRef.current?.focus());
              }}
              aria-label={reveal ? "Hide password" : "Show password"}
              aria-pressed={reveal}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-slate-400 transition-colors hover:text-slate-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600 dark:hover:text-slate-200"
            >
              {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </span>
        </label>

        <button
          type="button"
          onClick={() => setShowForgot((v) => !v)}
          aria-expanded={showForgot}
          className="mt-2 text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Forgot your password?
        </button>

        {showForgot ? (
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-slate-100 px-3 py-2.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">
            <HelpCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {forgotHint}
          </p>
        ) : null}
      </div>

      {error ? (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-400">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <Button type="submit" size="lg" className="w-full" disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
        Sign in
      </Button>
    </form>
  );
}
