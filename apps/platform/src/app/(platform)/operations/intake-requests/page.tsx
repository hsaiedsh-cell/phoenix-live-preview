import { IntakeOperationsClient } from '@/components/IntakeOperationsClient';
import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { getPhoenixApiConfig } from '@/lib/api-config';

export const dynamic = 'force-dynamic';

export default function IntakeRequestsPage() {
  const config = getPhoenixApiConfig();
  const enabled = config.mode === 'real-dev' || config.mode === 'production-auth';

  return (
    <div>
      <WorkspaceHeader
        eyebrow="Platform operations"
        title="Private Beta intake"
        description="Search, review, and update intake requests through the protected operator API."
      />
      {enabled ? <IntakeOperationsClient /> : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800">
          Intake operations require real-dev or production-auth mode. This page never falls back to mock customer data.
        </div>
      )}
    </div>
  );
}
