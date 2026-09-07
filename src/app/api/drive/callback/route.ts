import { NextResponse, type NextRequest } from "next/server";
import { google } from "googleapis";
import { requireCR } from "@/lib/auth";
import { oauthClient } from "@/lib/drive";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const cr = await requireCR();
  if (!cr) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const code = req.nextUrl.searchParams.get("code");
  if (!code) return NextResponse.redirect(new URL("/settings?drive=error", req.url));

  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/settings?drive=norefresh", req.url));
  }
  client.setCredentials(tokens);

  const me = await google.oauth2({ version: "v2", auth: client }).userinfo.get();

  await prisma.driveCredential.upsert({
    where: { id: "singleton" },
    update: { email: me.data.email ?? "unknown", refreshToken: tokens.refresh_token },
    create: {
      id: "singleton",
      email: me.data.email ?? "unknown",
      refreshToken: tokens.refresh_token,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId: cr.id,
      actorEmail: cr.email,
      action: "DRIVE_CONNECTED",
      metadata: { driveAccount: me.data.email },
    },
  });

  return NextResponse.redirect(new URL("/settings?drive=connected", req.url));
}
