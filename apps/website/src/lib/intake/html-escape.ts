// ============================================================
// HTML escaping helper
// PHX-LAUNCH-001-R1 §4.1
// ------------------------------------------------------------
// The single, tested escaping function every email template must
// route every dynamic value through before interpolating it into
// HTML. Pure function, no dependencies, fully unit-testable.
// ============================================================

const ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes the five HTML-significant characters. Never returns markup — the result is always safe to place inside HTML text content or a quoted attribute. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ESCAPE_MAP[char]);
}
