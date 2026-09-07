import { redirect } from "next/navigation";

/** Superseded by the flip card on /signin. */
export default function StudentRedirect() {
  redirect("/signin");
}
