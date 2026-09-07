import { redirect } from "next/navigation";
import { auth, isStaff } from "@/lib/auth";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/signin");
  redirect(isStaff(session.user.role) ? "/dashboard" : "/submit");
}
