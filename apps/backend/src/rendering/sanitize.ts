// ============================================================
// Phoenix Backend — Report Renderer Sanitization Helpers
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Three DISTINCT sanitizers, per format (Phase 1 Addendum A §6 —
// ChatGPT architecture/QA correction). Deliberately not one shared
// "sanitize everything the same way" helper:
//
//   - escapeHtml()        — HTML entity escaping. Used ONLY by the HTML
//                            renderer.
//   - sanitizeForPdfText() — control-character stripping + Unicode
//                            normalization. Used ONLY by the PDF
//                            renderer. Does NOT HTML-escape — pdfkit's
//                            text-drawing calls are not interpreting
//                            markup, so running text through
//                            escapeHtml() first would literally draw
//                            "&amp;" as visible characters in the PDF,
//                            corrupting the output. The real risk
//                            surface for a PDF text stream is malformed/
//                            adversarial control characters, not markup
//                            injection.
//   - csvCell()            — formula-injection-safe CSV cell writer.
//                            Used ONLY by the CSV renderer. Applies
//                            RFC-4180 quoting plus a leading-apostrophe
//                            prefix to STRING cells only, when their
//                            first character is one of =, +, -, @, a
//                            literal tab, or a literal CR — numeric
//                            cells are written as plain unquoted numbers
//                            and never run through this string-oriented
//                            path at all (csvNumericCell()).
// ============================================================

/** HTML entity escaping — used only by the HTML renderer. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Control-character stripping + Unicode NFC normalization for text
 * handed to pdfkit's text-drawing calls. Strips C0 control characters
 * below 0x20 except \n and \t (structurally meaningful line/tab breaks),
 * plus the 0x7F DEL character. Does NOT HTML-escape (see file header).
 */
export function sanitizeForPdfText(value: string): string {
  // eslint-disable-next-line no-control-regex
  const withoutControlChars = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  return withoutControlChars.normalize('NFC');
}

/** Characters that, as the FIRST character of a CSV cell, a spreadsheet application may interpret as a formula/command prefix. */
const CSV_FORMULA_INJECTION_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * RFC-4180-style quoting for a STRING/textual CSV cell, with
 * formula-injection neutralization: if the value's first character is
 * one of the CSV_FORMULA_INJECTION_PREFIXES, a leading single-quote is
 * prepended BEFORE quoting, so a spreadsheet application treats the cell
 * as inert literal text rather than a formula/command. Internal double
 * quotes are doubled per RFC 4180. Never used for numeric cells — see
 * csvNumericCell() below, which is written as a plain unquoted number
 * and never passed through this function.
 */
export function csvCell(value: string): string {
  const needsFormulaPrefix = CSV_FORMULA_INJECTION_PREFIXES.some((prefix) => value.startsWith(prefix));
  const safeValue = needsFormulaPrefix ? `'${value}` : value;
  const escaped = safeValue.replace(/"/g, '""');
  return `"${escaped}"`;
}

/**
 * Writes a numeric CSV cell as a plain, unquoted number — never run
 * through csvCell()'s string-prefixing path, so spreadsheet applications
 * continue to parse it as a number rather than text-with-a-leading-
 * apostrophe (Phase 1 Addendum A §6). `null`/`undefined` render as an
 * empty cell (truthful "not available", never a fabricated 0).
 */
export function csvNumericCell(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '';
  return String(value);
}

/** Joins already-prepared cells with commas and a trailing CRLF, per RFC 4180. */
export function csvRow(cells: string[]): string {
  return `${cells.join(',')}\r\n`;
}
