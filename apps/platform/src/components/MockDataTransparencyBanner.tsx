// ============================================================
// Phoenix Platform — MockDataTransparencyBanner
// PHX-PLATFORM-010-R1 — Clerk Config Gate & Mock Data Transparency Fix
// PHX-PLATFORM-011    — Live Read Migration for Production Auth
// ------------------------------------------------------------
// Issue 2 fix (Option A, preferred): a persistent, high-visibility
// banner shown on every signed-in production-auth route.
//
// PHX-PLATFORM-011 update (Task 8): the original 010-R1 copy said
// blanket "some platform data is still mock-backed" while EVERY page
// was still fully mock-backed. Now that /dashboard, /assessments,
// /assessments/[id], and /settings' activity/audit preview render live
// backend data in production-auth (see platform-data-source.ts), that
// blanket claim is no longer accurate — it would tell a signed-in user
// their live dashboard is "still mock-backed" when it isn't. The
// banner's copy is updated to be precise: core pages are live,
// Passports/Certifications/Reports remain preview-only (no backend
// endpoint exists yet for those — see PreviewOnlyNotice on those three
// pages). This banner is intentionally NOT removed entirely — it still
// exists because not every visible section is live yet.
//
// Rendered ONLY by ProductionAuthGate's signed-in branch — never in
// mock or real-dev mode (AuthGate.tsx, used in those modes, does not
// import this component at all), and never in production-auth's
// config-missing/signed-out states (there is no platform data to be
// transparent about in those states).
// ============================================================

export function MockDataTransparencyBanner() {
  return (
    <div
      role="status"
      className="sticky top-0 z-40 w-full bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-center text-xs font-medium text-amber-800"
    >
      Production-auth is active. Dashboard, Assessments, and Settings&apos; activity/audit preview show live backend
      data. Passports, Certifications, and Reports remain preview-only (mock-backed) until their live endpoints
      exist.
    </div>
  );
}
