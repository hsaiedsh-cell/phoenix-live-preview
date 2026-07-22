export const dynamic = 'force-dynamic';

import { WorkspaceHeader } from '@/components/WorkspaceHeader';
import { NewAssessmentWizard } from '@/components/NewAssessmentWizard';
import { RoleGate } from '@/components/RoleGate';
import { RestrictedNote } from '@/components/RestrictedNote';
import { getCurrentWorkspace } from '@/lib/api-client';

export default async function NewAssessmentPage() {
  const workspace = await getCurrentWorkspace();

  return (
    <div>
      <WorkspaceHeader
        eyebrow={workspace.data.name}
        title="New Assessment"
        description="Walk an AI-generated asset through the PBRS readiness workflow."
      />

      {/* PHX-PLATFORM-006 — UI-only gate; the wizard does not submit to a
          real backend either way in this Alpha. */}
      <RoleGate permission="canCreateAssessment" fallback={<RestrictedNote permission="canCreateAssessment" />}>
        <NewAssessmentWizard />
      </RoleGate>
    </div>
  );
}
