// ============================================================
// Phoenix Platform — PreviewModeBanner
// PHX-DEPLOY-004C — Vercel + Supabase Free Preview Adapter
// ------------------------------------------------------------
// vercel-supabase-preview counterpart to MockDataTransparencyBanner.
// Rendered ONLY by PreviewAuthGate's signed-in branch. Labels this
// deployment explicitly as a free-tier hosted preview reading a
// Supabase database directly (no separate backend host), and repeats
// the same "Passports/Certifications/Reports remain preview-only"
// boundary MockDataTransparencyBanner states for production-auth —
// this task's Task requirement #12.
// ============================================================

export function PreviewModeBanner() {
  return (
    <div
      role="status"
      className="sticky top-0 z-40 w-full bg-sky-50 border-b border-sky-200 px-4 py-2.5 text-center text-xs font-medium text-sky-800"
    >
      Free-tier hosted preview (Vercel + Supabase). Dashboard, Assessments, and Settings&apos; activity/audit preview
      read live Supabase/Postgres data directly, server-side. Passports, Certifications, and Reports remain
      preview-only (mock-backed) until their live endpoints exist. This is not a production launch.
    </div>
  );
}
