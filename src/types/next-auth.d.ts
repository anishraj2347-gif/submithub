import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "STUDENT" | "CR" | "ADMIN";
      enrollmentNo: string;
      mustChangePassword: boolean;
    } & DefaultSession["user"];
  }
}
