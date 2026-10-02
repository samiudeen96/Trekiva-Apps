/** Uses fetch (App Bridge adds the session token) then saves the blob. */
export async function downloadClaimsCsv() {
  const res = await fetch("/app/claims/export");
  if (!res.ok) throw new Error("Export failed");
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = "trekiva-claims.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
