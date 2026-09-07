/**
 * The documented credential patterns for this class.
 *
 * Passwords are stored as scrypt hashes and cannot be read back, so the admin
 * panel re-derives what a password *should* be. That is only truthful while
 * `passwordIsDefault` is set — a custom password is genuinely unrecoverable.
 */
export type Role = "STUDENT" | "CR" | "ADMIN";

/** "CR - Sam" + A00000000001  ->  "Sam - A00000000001" */
export function crPassword(loginId: string, enrollmentNo: string): string {
  const firstName = loginId.replace(/^CR\s*-\s*/i, "").trim();
  return `${firstName} - ${enrollmentNo}`;
}

/** What this person signs in with. */
export function defaultCredentials(person: {
  name: string;
  enrollmentNo: string;
  loginId: string | null;
  role: Role;
}): { user: string; password: string } {
  if (person.role === "CR" && person.loginId) {
    return {
      user: person.loginId,
      password: crPassword(person.loginId, person.enrollmentNo),
    };
  }
  return {
    user: person.loginId ?? person.name,
    password: person.enrollmentNo,
  };
}
