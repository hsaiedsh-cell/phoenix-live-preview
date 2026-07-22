import Link from 'next/link';

function PhoenixMark() {
  return (
    <svg width="40" height="46" viewBox="0 0 1731 1978" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M154 130L1259 130L1602 473V1015L1259 1358H639V1978H154V1258L639 773H1136L1259 1015L1136 1258H639V773L154 1258V130Z"
        fill="var(--phx-white)"
        fillRule="evenodd"
      />
      <rect x="154" y="1633" width="345" height="345" fill="var(--phx-cyan)" />
    </svg>
  );
}

export default function PlatformLandingPage() {
  return (
    <div className="min-h-screen bg-phx-navy flex flex-col">
      <header className="px-6 lg:px-8 py-6">
        <div className="max-w-7xl mx-auto flex items-center gap-2.5">
          <PhoenixMark />
          <span className="text-base font-extrabold tracking-tight text-white">PHOENIX PLATFORM</span>
        </div>
      </header>

      <main className="flex-1 flex items-center px-6 lg:px-8">
        <div className="max-w-3xl mx-auto text-center py-16">
          <span className="inline-flex items-center text-xs font-semibold tracking-widest text-phx-cyan bg-white/[0.06] px-3 py-1.5 rounded-full uppercase mb-6">
            Platform Alpha · UI Preview
          </span>
          <h1 className="text-4xl lg:text-5xl font-extrabold tracking-tight text-white leading-tight mb-5">
            The operating layer for enterprise AI readiness.
          </h1>
          <p className="text-base lg:text-lg text-gray-400 leading-relaxed max-w-xl mx-auto mb-10">
            Assessments, PBRS passports, certifications, and readiness reports —
            brought together in one workspace built for enterprise scale.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/login"
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-lg text-sm font-semibold bg-phx-cyan text-white hover:bg-phx-cyan-dark transition-colors shadow-sm"
            >
              Sign In to Platform
            </Link>
            <Link
              href="/dashboard"
              className="inline-flex items-center justify-center px-8 py-3.5 rounded-lg text-sm font-semibold border border-white/20 text-white hover:border-phx-cyan hover:text-phx-cyan transition-colors"
            >
              Preview Dashboard
            </Link>
          </div>
          <p className="mt-8 text-xs text-gray-600">
            This is an Alpha UI preview with sample data. No live scoring, certification, or backend is connected.
          </p>
        </div>
      </main>

      <footer className="px-6 lg:px-8 py-8 border-t border-white/[0.06] text-center">
        <p className="text-xs text-gray-500">© {new Date().getFullYear()} Phoenix. All rights reserved.</p>
      </footer>
    </div>
  );
}
