/** "Welcome 10%" -> "WELCOME10": the readable part of every per-claim code. */
export function claimCodePrefix(baseCode: string): string {
  return baseCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20) || "WELCOME";
}
