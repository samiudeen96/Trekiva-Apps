/** Canonical form used for every claim lookup and for the unique constraint. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
