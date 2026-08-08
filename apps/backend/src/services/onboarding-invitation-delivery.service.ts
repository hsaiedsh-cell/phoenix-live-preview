import { getDatabasePool } from '../db/client';

export interface InvitationEmailSender {
  send(input: { to: string; acceptUrl: string; expiresAt: string; idempotencyKey: string }): Promise<{ ok: boolean; providerCode?: string; errorCode?: string }>;
}

function read(name: string): string | undefined {
  const value = process.env[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function createResendInvitationSender(fetchImpl: typeof fetch = fetch): InvitationEmailSender {
  return {
    async send(input) {
      const apiKey = read('PHOENIX_ONBOARDING_RESEND_API_KEY');
      const from = read('PHOENIX_ONBOARDING_FROM_EMAIL');
      if (!apiKey || !from) return { ok: false, errorCode: 'CONFIG_MISSING' };
      try {
        const response = await fetchImpl('https://api.resend.com/emails', {
          method: 'POST', redirect: 'error',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
            'Idempotency-Key': input.idempotencyKey,
          },
          body: JSON.stringify({
            from, to: [input.to], subject: 'Your Phoenix workspace invitation',
            html: `<p>You have been invited to Phoenix.</p><p><a href="${input.acceptUrl}">Accept invitation</a></p><p>This invitation expires at ${input.expiresAt}.</p>`,
            text: `You have been invited to Phoenix. Accept: ${input.acceptUrl}\nExpires: ${input.expiresAt}`,
          }),
        });
        if (!response.ok) return { ok: false, errorCode: `HTTP_${response.status}` };
        return { ok: true, providerCode: 'resend' };
      } catch {
        return { ok: false, errorCode: 'NETWORK_ERROR' };
      }
    },
  };
}

export async function deliverOnboardingInvitation(
  issued: { invitationId: string; token: string; expiresAt: string },
  sender: InvitationEmailSender = createResendInvitationSender()
): Promise<{ status: 'Sent' | 'Failed' }> {
  const pool = getDatabasePool();
  const target = await pool.query<{ email: string; status: string }>(
    `SELECT u.email::text AS email, oi.status
     FROM onboarding_invitations oi JOIN users u ON u.id=oi.user_id
     WHERE oi.id=$1 AND u.deleted_at IS NULL LIMIT 1`, [issued.invitationId]
  );
  if (!target.rows[0] || target.rows[0].status !== 'Issued') return { status: 'Failed' };
  const baseUrl = read('PHOENIX_ONBOARDING_APP_BASE_URL');
  let acceptUrl: string | null = null;
  try {
    if (baseUrl) {
      const url = new URL('/onboarding/accept', baseUrl);
      if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) {
        url.hash = `token=${encodeURIComponent(issued.token)}`;
        acceptUrl = url.toString();
      }
    }
  } catch { acceptUrl = null; }
  const result = acceptUrl
    ? await sender.send({ to: target.rows[0].email, acceptUrl, expiresAt: issued.expiresAt, idempotencyKey: `onboarding-invitation:${issued.invitationId}` })
    : { ok: false, errorCode: 'CONFIG_MISSING' };
  await pool.query(
    `UPDATE onboarding_invitation_deliveries SET status=$2,attempt_count=attempt_count+1,
     provider_code=$3,last_error_code=$4,sent_at=CASE WHEN $2='Sent' THEN now() ELSE NULL END,updated_at=now()
     WHERE invitation_id=$1 AND status='Pending'`,
    [issued.invitationId, result.ok ? 'Sent' : 'Failed', result.ok ? (result.providerCode ?? 'provider') : null,
      result.ok ? null : (result.errorCode ?? 'DELIVERY_FAILED').slice(0, 100)]
  );
  return { status: result.ok ? 'Sent' : 'Failed' };
}
