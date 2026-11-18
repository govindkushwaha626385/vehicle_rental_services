/** Shared CSV export helper for the admin console (invoices, bookings, users). */

const csvCell = (value) => {
  let text = String(value ?? '');
  // Neutralise spreadsheet formulas so a crafted customer name or note cannot
  // execute when staff open the export in Excel or Sheets. Negative numbers are
  // left alone so refunds still sort and sum correctly.
  if (/^[=+@\t\r]/.test(text) || /^-\D/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

/** Build a UTF-8 BOM-prefixed CSV and trigger a download without any server call. */
export function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Safari cancels a download when its blob URL is revoked in the same tick.
  // Give the browser a moment to hand the file to the download manager.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}