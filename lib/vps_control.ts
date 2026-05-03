/**
 * Talks to the vps-monitor HTTP API on the Vultr VPS.
 * Used to pause/resume marketing-emails around the upload so it doesn't
 * starve Mautic of CPU during the import.
 *
 * The API is exposed at https://ops.dynamixsolutions.org and authenticated
 * via Bearer token (env: VPS_OPS_API_TOKEN).
 *
 * Failures are LOGGED, not fatal — the upload continues even if the
 * pause/resume call fails. (Mautic will be slower in that case but the
 * upload still works thanks to the retry-on-504 logic.)
 */

const OPS_BASE_URL = (process.env.VPS_OPS_API_URL || 'https://ops.dynamixsolutions.org').replace(/\/$/, '');
const OPS_TOKEN = process.env.VPS_OPS_API_TOKEN || '';

export type ControlResult = {
  ok: boolean;
  message: string;
  attempted: boolean;
};

async function call(path: string, method: 'POST' | 'GET' = 'POST'): Promise<ControlResult> {
  if (!OPS_TOKEN) {
    return { ok: false, message: 'VPS_OPS_API_TOKEN not configured', attempted: false };
  }
  try {
    const res = await fetch(`${OPS_BASE_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${OPS_TOKEN}` },
    });
    let data: any = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON */
    }
    return {
      ok: res.ok && (data?.ok ?? true),
      message: data?.message || `HTTP ${res.status}`,
      attempted: true,
    };
  } catch (e: any) {
    return { ok: false, message: e?.message || 'Network error', attempted: true };
  }
}

export async function pauseMarketingEmails(): Promise<ControlResult> {
  return call('/api/v1/pause/marketing-emails');
}

export async function resumeMarketingEmails(): Promise<ControlResult> {
  return call('/api/v1/unpause/marketing-emails');
}

export async function pingOps(): Promise<ControlResult> {
  return call('/healthz', 'GET');
}
