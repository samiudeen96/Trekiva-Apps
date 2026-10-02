/** CSV cell with RFC 4180 quoting and protection against spreadsheet formula injection. */
export function csvCell(value: string | null | undefined): string {
  let v = value ?? "";
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const csvRow = (cells: (string | null | undefined)[]) => cells.map(csvCell).join(",") + "\r\n";
