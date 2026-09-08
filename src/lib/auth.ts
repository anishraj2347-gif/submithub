import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";

const allowedDomain = (process.env.ALLOWED_EMAIL_DOMAIN ?? "").trim();

/**
 * Students sign in with their enrollment number (or name) and a password the
 * CR issues. Google remains available so the CR can also use it, and it is a
 * separate flow from the Drive connection at /api/drive/connect.
 */
async function findByLoginId(loginId: string) {
  const id = loginId.trim();
  if (!id) return { student: null as null, ambiguous: false };

  // An explicit alias wins, e.g. "CR - Dev".
  const byAlias = await prisma.student.findFirst({
    where: { loginId: { equals: id, mode: "insensitive" } },
  });
  if (byAlias) return { student: byAlias, ambiguous: false };

  const byEnrollment = await prisma.student.findFirst({
    where: { enrollmentNo: { equals: id, mode: "insensitive" } },
  });
  if (byEnrollment) return { student: byEnrollment, ambiguous: false };

  const byName = await prisma.student.findMany({
    where: { name: { equals: id, mode: "insensitive" } },
  });
  // Two students share a name on this roster, so a name alone is not an identity.
  if (byName.length > 1) return { student: null, ambiguous: true };
  return { student: byName[0] ?? null, ambiguous: false };
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      id: "credentials",
      name: "Enrollment number and password",
      credentials: {
        loginId: { label: "Enrollment number", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(raw) {
        const loginId = typeof raw?.loginId === "string" ? raw.loginId : "";
        const password = typeof raw?.password === "string" ? raw.password : "";
        if (!loginId || !password) return null;

        const { student, ambiguous } = await findByLoginId(loginId);
        if (ambiguous) throw new Error("AmbiguousName");
        if (!student) return null;
        if (!verifyPassword(password, student.passwordHash)) return null;

        return {
          id: student.id,
          name: student.name,
          email: student.email ?? `${student.enrollmentNo.toLowerCase()}@roster.local`,
        };
      },
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: allowedDomain
          ? { hd: allowedDomain, prompt: "select_account" }
          : { prompt: "select_account" },
      },
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/staff", error: "/staff" },
  callbacks: {
    /**
     * Google is the admin door only. CRs and students sign in with an
     * enrollment number / alias and a password, never Google.
     */
    async signIn({ user, account }) {
      if (account?.provider === "credentials") return true;

      const email = user.email?.toLowerCase();
      if (!email) return false;
      if (allowedDomain && !email.endsWith(`@${allowedDomain.toLowerCase()}`)) return false;

      const student = await prisma.student.findFirst({ where: { email } });
      if (!student) return false;
      // A CR or student who happens to have an email on file still cannot
      // get in this way — Google is reserved for the admin account.
      return student.role === "ADMIN";
    },
    async jwt({ token, user }) {
      // Try each identifier in turn rather than committing to one: credentials
      // sign-in puts the roster id on `user`, but Google puts *its own* account
      // id there, so that lookup misses and we must fall back to the email.
      const email = (user?.email ?? token.email)?.toLowerCase();

      let student =
        (user?.id ? await prisma.student.findUnique({ where: { id: user.id } }) : null) ??
        (token.studentId
          ? await prisma.student.findUnique({ where: { id: token.studentId as string } })
          : null);

      if (!student && email) {
        student = await prisma.student.findFirst({ where: { email } });
      }

      if (!student) {
        // The roster changed under an existing session (student removed or
        // re-seeded). Strip the identity so the session stops authenticating.
        delete token.studentId;
        delete token.role;
        delete token.enrollmentNo;
        delete token.mustChangePassword;
        return token;
      }

      token.studentId = student.id;
      token.role = student.role;
      token.enrollmentNo = student.enrollmentNo;
      token.name = student.name;
      token.mustChangePassword = student.mustChangePassword;
      return token;
    },
    async session({ session, token }) {
      // No roster row behind this token: hand back a session with no user id,
      // which requireUser() treats as signed out.
      if (!token.studentId) {
        return { ...session, user: undefined } as unknown as typeof session;
      }
      if (session.user) {
        session.user.id = token.studentId as string;
        session.user.role = token.role as "STUDENT" | "CR";
        session.user.enrollmentNo = token.enrollmentNo as string;
        session.user.mustChangePassword = Boolean(token.mustChangePassword);
      }
      return session;
    },
  },
});

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) return null;
  return session.user;
}

/** ADMIN outranks CR, so anything a CR may do, an admin may do too. */
export function isStaff(role: string | undefined): boolean {
  return role === "CR" || role === "ADMIN";
}

export async function requireAdmin() {
  const user = await requireUser();
  if (!user || user.role !== "ADMIN") return null;
  return user;
}

export async function requireCR() {
  const user = await requireUser();
  if (!user || !isStaff(user.role)) return null;
  return user;
}
