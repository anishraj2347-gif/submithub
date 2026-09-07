"use client";

import * as React from "react";
import { signIn } from "next-auth/react";
import { GraduationCap, KeyRound, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui";
import { StackedCard } from "@/components/auth-card";
import { SignInForm } from "./signin-form";
import { cn } from "@/lib/utils";

type Role = "student" | "staff";

/**
 * One card, two faces. The role tabs flip the card on its Y axis; each face
 * carries its own form and its own mascot, so whichever side is showing
 * reacts to what is being typed on it.
 */
export function AuthSwitcher({ initialRole = "student" }: { initialRole?: Role }) {
  const [role, setRole] = React.useState<Role>(initialRole);
  const isStaff = role === "staff";

  return (
    <div>
      {/* role tabs */}
      <div
        role="tablist"
        aria-label="Choose how to sign in"
        className="mx-auto mb-5 flex w-full max-w-xs rounded-full border border-slate-200 bg-white/80 p-1 backdrop-blur dark:border-slate-800 dark:bg-slate-900/70"
      >
        {(
          [
            { key: "student", label: "Student", icon: GraduationCap },
            { key: "staff", label: "CR & Admin", icon: KeyRound },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={role === t.key}
            onClick={() => setRole(t.key)}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-all",
              role === t.key
                ? "bg-indigo-600 text-white shadow-sm"
                : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {/* flip stage — both faces share a grid cell so the card sizes to the taller one */}
      <div className="[perspective:1600px]">
        <div
          className={cn(
            "grid transition-transform duration-500 [transform-style:preserve-3d]",
            isStaff && "[transform:rotateY(180deg)]"
          )}
        >
          {/* front — student */}
          <div
            aria-hidden={isStaff}
            // backface-visibility hides the far face visually but it still
            // occupies the grid cell, so it must stop capturing clicks too.
            className={cn(
              "col-start-1 row-start-1 [backface-visibility:hidden]",
              isStaff ? "pointer-events-none" : "pointer-events-auto"
            )}
          >
            <StackedCard>
              <Header
                icon={<GraduationCap className="h-5 w-5" />}
                tone="bg-indigo-600 text-white"
                title="Student sign-in"
                subtitle="C++ assignment submission"
              />
              <p className="mt-5 text-sm text-slate-600 dark:text-slate-300">
                Sign in with your name. Your password is your enrollment number.
              </p>
              <SignInForm
                label="Your name"
                placeholder="Your full name"
                hint="As it appears on the class list. You can also use your enrollment number."
                ambiguousHint="Another student has the same name. Sign in with your enrollment number instead."
                forgotHint="Your password is your enrollment number. If you still cannot sign in, contact your CR."
                active={!isStaff}
              />
              <p className="mt-5 text-center text-xs text-slate-500 dark:text-slate-400">
                Only students on the class roster can sign in.
              </p>
            </StackedCard>
          </div>

          {/* back — CR & admin */}
          <div
            aria-hidden={!isStaff}
            className={cn(
              "col-start-1 row-start-1 [backface-visibility:hidden] [transform:rotateY(180deg)]",
              isStaff ? "pointer-events-auto" : "pointer-events-none"
            )}
          >
            <StackedCard>
              <Header
                icon={<KeyRound className="h-5 w-5" />}
                tone="bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                title="Staff sign-in"
                subtitle="Class representatives and admin"
              />
              <SignInForm
                label="CR ID"
                placeholder=""
                suggest={false}
                ambiguousHint="That name matches more than one person. Use your CR ID."
                forgotHint="Contact the admin to have your password reset."
                active={isStaff}
              />

              <div className="my-5 flex items-center gap-3">
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
                <span className="text-xs text-slate-400">Admin only</span>
                <span className="h-px flex-1 bg-slate-200 dark:bg-slate-800" />
              </div>

              <Button
                variant="secondary"
                className="w-full"
                type="button"
                onClick={() => signIn("google", { callbackUrl: "/" })}
              >
                <ShieldCheck className="h-4 w-4" />
                Admin sign-in with Google
              </Button>
            </StackedCard>
          </div>
        </div>
      </div>
    </div>
  );
}

function Header({
  icon,
  tone,
  title,
  subtitle,
}: {
  icon: React.ReactNode;
  tone: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className={cn("rounded-lg p-2", tone)}>{icon}</span>
      <div>
        <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>
      </div>
    </div>
  );
}
