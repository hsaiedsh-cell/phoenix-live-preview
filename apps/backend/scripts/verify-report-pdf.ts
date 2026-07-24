// ============================================================
// Phoenix Backend — Report PDF Validation QA Script
// PHX-REPORTS-004 — Report Generation Lifecycle & Secure Artifact
// Delivery Foundation
// ------------------------------------------------------------
// Concrete "opens in a standard PDF reader" proof (task brief §9.5),
// per Phase 1 Addendum A §10: confirms (a) the buffer's first bytes
// match the %PDF-1. signature, (b) pdf-parse (a pure-JS PDF parser,
// devDependency only — never imported by production backend code)
// resolves without throwing and reports numpages >= 1.
//
// Usage:
//   npx tsx src/scripts-support/verify-report-pdf.ts <path-to-pdf>
// ============================================================

import { readFileSync } from 'node:fs';

async function main(): Promise<void> {
  const path = process.argv[2];
  if (!path) {
    // eslint-disable-next-line no-console
    console.error('Usage: verify-report-pdf.ts <path-to-pdf>');
    process.exit(1);
  }

  const bytes = readFileSync(path);
  const signature = bytes.subarray(0, 8).toString('latin1');

  if (!signature.startsWith('%PDF-1.') && !signature.startsWith('%PDF-2.')) {
    // eslint-disable-next-line no-console
    console.error(`FAIL: file does not start with a valid PDF signature. Got: ${JSON.stringify(signature)}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`PDF signature OK: ${signature}`);

  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: bytes });
  try {
    const info = await parser.getInfo();
    if (!info.total || info.total < 1) {
      // eslint-disable-next-line no-console
      console.error(`FAIL: pdf-parse reported ${info.total} pages.`);
      process.exit(1);
    }
    // eslint-disable-next-line no-console
    console.log(`pdf-parse OK: ${info.total} page(s), Producer=${info.info?.Producer ?? 'unknown'}`);
  } finally {
    await parser.destroy();
  }

  // eslint-disable-next-line no-console
  console.log('PASS');
}

void main();
