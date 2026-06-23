import type { LeadBitesRow } from './csv';

const BASE_URL = (process.env.LISTMONK_BASE_URL || '').replace(/\/$/, '');
const API_USER = process.env.LISTMONK_API_USER || '';
const API_TOKEN = process.env.LISTMONK_API_TOKEN || '';
const LIST_ID = parseInt(process.env.LISTMONK_LIST_ID || '3', 10);

// MUST stay 'lead-bites' (hyphen) — orchestrator JSONB query:
// attribs->'tags' @> '["lead-bites"]'  (src/orchestrator.py TAG_LEAD_BITES)
// Space-form 'lead bites' was a 2026-05-29 bug; never revert.
const LEAD_TAG = 'lead-bites';

// Never re-enroll contacts who graduated or replied.
const SKIP_TAGS = new Set(['lead-bites-complete', 'lead-bites-replied']);

if (!BASE_URL || !API_USER || !API_TOKEN) {
  console.warn('listmonk env vars are not fully configured');
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${API_USER}:${API_TOKEN}`).toString('base64');
}

export type BatchResult = {
  created: number;
  updated: number;
  failed: number;
  failures: Array<{ email: string; error: string }>;
};

export async function testConnection(): Promise<{ ok: boolean; status: number; message: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, {
      headers: { Authorization: authHeader() },
    });
    if (res.ok) return { ok: true, status: res.status, message: 'Connected' };
    const text = await res.text();
    return { ok: false, status: res.status, message: text.slice(0, 200) };
  } catch (e: any) {
    return { ok: false, status: 0, message: e?.message || 'Network error' };
  }
}

function rowToPayload(row: LeadBitesRow, nowIso: string): Record<string, any> {
  const name = [row.firstName, row.lastName].filter(Boolean).join(' ') || row.email;
  const attribs: Record<string, any> = {
    tags: [LEAD_TAG],
    date_added: nowIso,
  };
  const optionals: Array<[string, string]> = [
    ['firstname', row.firstName],
    ['lastname', row.lastName],
    ['position', row.position],
    ['company', row.organization],
    ['website', row.website],
    ['city', row.city],
    ['state', row.state],
    ['country', row.country],
    ['industry', row.industries],
    ['employee_count', row.numberOfEmployees],
    ['linkedin_url', row.decisionMakerLinkedIn],
    ['description', row.description],
  ];
  for (const [k, v] of optionals) {
    if (v) attribs[k] = v;
  }
  return {
    email: row.email,
    name,
    status: 'enabled',
    lists: [LIST_ID],
    attribs,
    preconfirm_subscriptions: true,
  };
}

async function getExistingSubscriber(
  email: string,
): Promise<{ id: number; attribs: any; lists: any[] } | null> {
  const query = `subscribers.email = '${email.replace(/'/g, "''")}'`;
  const url = new URL(`${BASE_URL}/api/subscribers`);
  url.searchParams.set('query', query);
  url.searchParams.set('per_page', '1');
  const res = await fetch(url.toString(), {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Subscriber lookup failed: ${res.status}`);
  const data: any = await res.json();
  const results = data?.data?.results;
  if (!Array.isArray(results) || results.length === 0) return null;
  const s = results[0];
  return { id: s.id, attribs: s.attribs || {}, lists: s.lists || [] };
}

async function processRow(row: LeadBitesRow, nowIso: string): Promise<'created' | 'updated' | 'skipped'> {
  const payload = rowToPayload(row, nowIso);

  const createRes = await fetch(`${BASE_URL}/api/subscribers`, {
    method: 'POST',
    headers: { Authorization: authHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });

  if (createRes.status === 200) return 'created';

  if (createRes.status === 409) {
    const existing = await getExistingSubscriber(row.email);
    if (!existing) throw new Error('409 conflict but subscriber lookup returned nothing');

    const tags: string[] = (existing.attribs.tags || []).map((t: any) => String(t).toLowerCase());

    // Graduated or replied — do not re-enroll
    if (tags.some((t) => SKIP_TAGS.has(t))) return 'skipped';

    // Already has the lead-bites tag — nothing to change
    if (tags.includes(LEAD_TAG)) return 'updated';

    // Add tag + fill any empty attrib fields (never clobber existing data)
    const newAttribs = { ...existing.attribs };
    newAttribs.tags = [...tags, LEAD_TAG];
    for (const [k, v] of Object.entries(payload.attribs)) {
      if (k !== 'tags' && !newAttribs[k] && v) newAttribs[k] = v;
    }

    // Preserve existing list memberships; add our list if missing
    const listIds: number[] = existing.lists.map((l: any) =>
      typeof l === 'object' && l !== null ? l.id : Number(l),
    );
    if (!listIds.includes(LIST_ID)) listIds.push(LIST_ID);

    const putRes = await fetch(`${BASE_URL}/api/subscribers/${existing.id}`, {
      method: 'PUT',
      headers: { Authorization: authHeader(), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        email: row.email,
        name: payload.name,
        status: 'enabled',
        lists: listIds,
        attribs: newAttribs,
      }),
    });
    if (!putRes.ok) {
      throw new Error(`Tag PUT failed: ${putRes.status} ${(await putRes.text()).slice(0, 200)}`);
    }
    return 'updated';
  }

  throw new Error(`Create failed: ${createRes.status} ${(await createRes.text()).slice(0, 200)}`);
}

async function pLimit<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: string }>> {
  const results: Array<{ item: T; ok: true; value: R } | { item: T; ok: false; error: string }> = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      const item = items[idx];
      try {
        const value = await fn(item);
        results[idx] = { item, ok: true, value };
      } catch (e: any) {
        results[idx] = { item, ok: false, error: e?.message || 'Unknown error' };
      }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Process a batch of rows against listmonk.
 * Concurrency 5 keeps total well under Vercel Hobby 10s timeout.
 * Recommended batch size: 5–10 rows.
 */
export async function processBatch(rows: LeadBitesRow[]): Promise<BatchResult> {
  const nowIso = new Date().toISOString();
  const results = await pLimit(rows, 5, (row) => processRow(row, nowIso));

  let created = 0;
  let updated = 0;
  const failures: Array<{ email: string; error: string }> = [];

  for (const r of results) {
    if (r.ok) {
      if (r.value === 'created') created++;
      else if (r.value === 'updated') updated++;
      // 'skipped' (graduated/replied) counts neither as success nor failure
    } else {
      failures.push({ email: (r.item as LeadBitesRow).email, error: r.error });
    }
  }

  return { created, updated, failed: failures.length, failures };
}
