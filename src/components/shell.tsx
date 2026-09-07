import Link from "next/link";
import { GraduationCap, LayoutDashboard, Upload, Settings } from "lucide-react";
import { signOut } from "@/lib/auth";
import { Button } from "@/components/ui";

export function AppShell({
  children,
  user,
}: {
  children: React.ReactNode;
  user: { name?: string | null; email?: string | null; role: "STUDENT" | "CR" | "ADMIN"; enrollmentNo: string };
}) {
  const nav =
    user.role === "CR" || user.role === "ADMIN"
      ? [
          { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
          { href: "/settings", label: "Settings", icon: Settings },
        ]
      : [{ href: "/submit", label: "Submit", icon: Upload }];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur dark:border-slate-800 dark:bg-slate-950/80">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="rounded-lg bg-indigo-600 p-1.5 text-white">
              <GraduationCap className="h-4 w-4" />
            </span>
            <span className="text-sm font-semibold tracking-tight">SubmitHub</span>
          </Link>

          <nav className="ml-2 hidden items-center gap-1 sm:flex">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-medium leading-tight">{user.name}</p>
              <p className="text-[11px] leading-tight text-slate-500 dark:text-slate-400">
                {user.enrollmentNo} · {user.role === "ADMIN" ? "Admin" : user.role === "CR" ? "Class Rep" : "Student"}
              </p>
            </div>
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
              {(user.name ?? "?").slice(0, 1).toUpperCase()}
            </span>
            <form
              action={async () => {
                "use server";
                await signOut({ redirectTo: "/signin" });
              }}
            >
              <Button variant="ghost" size="sm" type="submit">
                Sign out
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
