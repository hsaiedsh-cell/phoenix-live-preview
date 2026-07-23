// ============================================================
// Phoenix Platform — LiveCertificationsTable
// PHX-CERTIFICATIONS-001 — Live Certifications List (preview mode)
// ------------------------------------------------------------
// Renders previewGetCertifications() rows (BackendCertification) for
// vercel-supabase-preview mode. Deliberately a table, not a card grid:
// the mock certifications page already renders its "Certified Assets"
// section as a table (AssessmentTable, fed certifiedItems) — this keeps
// the live rendering visually consistent with the mock rendering of the
// SAME page section, the same reasoning LivePassportCard.tsx used to
// choose a card grid (because PassportCard/the mock passports page is a
// card grid). Deliberately NOT AssessmentTable itself — that component
// expects the full mock AssessmentListItemViewModel shape (owner name,
// full PBRSScoreRecord, etc.) this read-only migration's endpoint does
// not return.
//
// Certification Level (PBRS Foundation/Practitioner/Enterprise) is
// intentionally not shown here — it is derived from `scoreSnapshot` via
// lib/certification-levels.ts, and this table shows the stored PBRS
// Internal Tier (`tier`) and `status` columns as persisted, matching
// this sprint's read-only scope (no presentation-layer derivation
// beyond what LivePassportCard.tsx already establishes for the
// passports list).
// ============================================================

import Link from 'next/link';
import type { BackendCertification } from '@/lib/real-api-client';
import { EmptyState } from './EmptyState';
import { IconShieldBadge } from './Icons';

/** Same safe-formatting convention as LivePassportCard.tsx / LiveAssessmentsTable.tsx — never call .slice() on an unguarded value. */
function formatPreviewDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

interface LiveCertificationsTableProps {
  items: BackendCertification[];
}

export function LiveCertificationsTable({ items }: LiveCertificationsTableProps) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<IconShieldBadge />}
        title="No live certifications yet"
        description="Certifications granted in this workspace will appear here once they exist in the live database."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50/60 text-left">
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Asset</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">
              Certification ID
            </th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">
              Internal Tier
            </th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Status</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Score</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Issued</th>
            <th className="px-5 py-3 font-semibold text-gray-500 text-xs uppercase tracking-wide">Expires</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-gray-100 last:border-b-0 hover:bg-gray-50/60">
              <td className="px-5 py-3.5">
                <Link
                  href={`/assessments/${item.assessmentId}`}
                  className="font-semibold text-phx-navy hover:text-phx-cyan-dark"
                >
                  {item.assetName}
                </Link>
              </td>
              <td className="px-5 py-3.5 text-gray-600">{item.certificationId}</td>
              <td className="px-5 py-3.5 text-gray-600">{item.tier}</td>
              <td className="px-5 py-3.5 text-gray-600">{item.status}</td>
              <td className="px-5 py-3.5 text-gray-600">{item.scoreSnapshot}</td>
              <td className="px-5 py-3.5 text-gray-400 text-xs">{formatPreviewDate(item.issuedDate)}</td>
              <td className="px-5 py-3.5 text-gray-400 text-xs">{formatPreviewDate(item.expiryDate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 py-3 text-[11px] text-gray-500 border-t border-gray-100">
        Certification granting, revocation, and public verification are preview-only for live data — no action is
        available for these records yet.
      </p>
    </div>
  );
}
