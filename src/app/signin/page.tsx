import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { AuthStage } from "@/components/auth-card";
import { AuthSwitcher } from "./auth-switcher";

/** The single sign-in page: one card that flips between student and staff. */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const session = await auth();
  if (session?.user) redirect("/");
  const { role } = await searchParams;

  return (
    <AuthStage>
      <AuthSwitcher initialRole={role === "staff" ? "staff" : "student"} />
    </AuthStage>
  );
}
