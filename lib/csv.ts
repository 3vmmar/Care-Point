/**
 * CSV escaping, in one place.
 *
 * Two exports in this codebase produce spreadsheets from patient-supplied text:
 * the appointment register at `app/api/clinic/export/route.ts` and the
 * data-subject-access pack in the Clinic OS Requests view. They were written
 * months apart and only one of them guarded against formula injection, which is
 * exactly how that class of bug survives — the fix exists, in the wrong file.
 *
 * The risk is concrete. A patient can type their name into the public booking
 * form. If they type `=HYPERLINK("https://…","Click")`, Excel and Google Sheets
 * treat the cell as a formula the moment a staff member opens the file, on a
 * clinic machine, with the whole register in front of them. Quoting alone does
 * not stop it: the leading `=` survives the quotes.
 */

/**
 * Escapes one value for a CSV cell.
 *
 * Quotes unconditionally, doubles any internal quote, and neutralises the four
 * characters a spreadsheet reads as "this is a formula" by prefixing a single
 * quote — which the spreadsheet consumes and the human never sees.
 */
export function csvCell(value: string | null | undefined): string {
  const text = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replace(/"/g, '""')}"`;
}

/**
 * Assembles rows into a CSV document.
 *
 * CRLF line endings because Excel on Windows is the overwhelmingly likely
 * consumer, and a byte-order mark because without one Excel reads the Arabic
 * patient names as mojibake — which has happened, and which makes the export
 * useless for half of this practice's patients.
 */
export function csvDocument(header: readonly string[], rows: readonly (readonly (string | null | undefined)[])[]): string {
  const lines = [
    header.map(csvCell).join(","),
    ...rows.map((row) => row.map(csvCell).join(",")),
  ];
  return `﻿${lines.join("\r\n")}`;
}
