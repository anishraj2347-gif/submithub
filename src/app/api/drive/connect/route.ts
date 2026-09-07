import { NextResponse } from "next/server";
import { requireCR } from "@/lib/auth";
import { oauthClient, DRIVE_SCOPES } from "@/lib/drive";

export async function GET() {
  const cr = await requireCR();
  if (!cr) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token even on re-connect
    scope: DRIVE_SCOPES,
  });
  return NextResponse.redirect(url);
}
