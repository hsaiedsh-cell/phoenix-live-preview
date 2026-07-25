// ============================================================
// File extension validation
// PHX-LAUNCH-001-R1 §1.4
// ------------------------------------------------------------
// Never relies on the browser `accept` attribute or client-declared
// MIME type. Two independent checks, both pure functions:
//   1. isDangerousExtension — a hard denylist that rejects
//      archives/executables/scripts/macro-enabled Office files
//      regardless of what content type accompanies them.
//   2. isExtensionCompatibleWithMimeType — an explicit allowlist
//      mapping each approved MIME type to the extensions it may
//      legitimately appear with, so e.g. a ".exe" renamed to claim
//      "application/pdf" is still rejected (wrong extension for that
//      MIME type), and a genuinely-PDF file with a ".docm" extension
//      is also rejected (macro-enabled extension is always denied,
//      even if paired with an otherwise-allowed MIME type).
// ============================================================

const DANGEROUS_EXTENSIONS = new Set([
  '.zip',
  '.rar',
  '.7z',
  '.exe',
  '.dll',
  '.sh',
  '.bat',
  '.cmd',
  '.js',
  '.mjs',
  '.ps1',
  '.docm',
  '.dotm',
  '.xlsm',
  '.xltm',
  '.pptm',
  '.potm',
  '.ppam',
]);

const MIME_TO_ALLOWED_EXTENSIONS: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'text/plain': ['.txt'],
};

/** Returns the lowercased extension including the leading dot, or '' if the filename has none. */
export function extractExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  if (lastDot === -1 || lastDot === filename.length - 1) return '';
  return filename.slice(lastDot).toLowerCase();
}

export function isDangerousExtension(filename: string): boolean {
  return DANGEROUS_EXTENSIONS.has(extractExtension(filename));
}

/** True only if the extension is one of the specific extensions approved for this exact MIME type. */
export function isExtensionCompatibleWithMimeType(filename: string, mimeType: string): boolean {
  const ext = extractExtension(filename);
  if (!ext) return false;
  if (DANGEROUS_EXTENSIONS.has(ext)) return false;
  const allowed = MIME_TO_ALLOWED_EXTENSIONS[mimeType];
  if (!allowed) return false;
  return allowed.includes(ext);
}
