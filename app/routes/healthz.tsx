import db from "../db.server";

// Unauthenticated liveness + database check for Docker / the reverse proxy.
export const loader = async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "db_unavailable" }, { status: 503 });
  }
};
