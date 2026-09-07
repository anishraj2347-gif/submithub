import { redirect } from "next/navigation";

/** Kept so existing links and bookmarks land on the staff face of the card. */
export default function StaffRedirect() {
  redirect("/signin?role=staff");
}
