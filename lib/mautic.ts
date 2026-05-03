import type { LeadBitesRow } from './csv';

const BASE_URL = (process.env.MAUTIC_BASE_URL || '').replace(/\/$/, '');
const USERNAME = process.env.MAUTIC_USERNAME || '';
const PASSWORD = process.env.MAUTIC_PASSWORD || '';
const LEAD_TAG = process.env.LEAD_TAG || 'lead bites';

if (!BASE_URL || !USERNAME || !PASSWORD) {
  console.warn('Mautic env vars are not fully configured');
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
}

export type BatchResult = {
  created: number;
  updated: number;
  failed: number;
  failures: Array<{ email: string; error: string }>;
};

/**
 * Test that we can reach Mautic and the credentials work.
 */
export async function testConnection(): Promise<{ ok: boolean; status: number; message: string }> {
  try {
    const res = await fetch(`${BASE_URL}/api/contacts?limit=1`, {
      headers: { Authorization: authHeader(), Accept: 'application/json' },
    });
    if (res.ok) return { ok: true, status: res.status, message: 'Connected' };
    const text = await res.text();
    return { ok: false, status: res.status, message: text.slice(0, 200) };
  } catch (e: any) {
    return { ok: false, status: 0, message: e?.message || 'Network error' };
  }
}

/**
 * Find an existing contact by email. Returns id+tags or null.
 */
async function findContactByEmail(
  email: string,
): Promise<{ id: number; tags: string[] } | null> {
  const url = new URL(`${BASE_URL}/api/contacts`);
  url.searchParams.set('search', `email:${email}`);
  url.searchParams.set('limit', '1');

  const res = await fetch(url.toString(), {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`Search failed: ${res.status}`);
  }
  const data: any = await res.json();
  const contacts: Record<string, any> = data.contacts || {};
  const ids = Object.keys(contacts);
  if (ids.length === 0) return null;
  const c = contacts[ids[0]];
  let tags: string[] = [];
  if (Array.isArray(c.tags)) {
    tags = c.tags.map((t: any) => (typeof t === 'string' ? t : t?.tag)).filter(Boolean);
  } else if (c.tags && typeof c.tags === 'object') {
    tags = Object.values(c.tags as Record<string, { tag: string }>)
      .map((t: any) => t?.tag)
      .filter(Boolean);
  }
  return { id: Number(c.id), tags };
}

function rowToContactBody(row: LeadBitesRow, includeTags: boolean): Record<string, any> {
  // Note: do NOT send `state` — Mautic validates it against a whitelist per country
  // (US states, Indian states, etc.). International values like "Catalonia" or Korean
  // provinces get rejected with HTTP 400 "state: This value is not valid."
  // City + country is enough for personalization in our cold-email sequence.
  const body: Record<string, any> = {
    firstname: row.firstName,
    lastname: row.lastName,
    email: row.email,
    position: row.position,
    company: row.organization,
    website: row.website,
    city: row.city,
    country: row.country,
  };
  if (includeTags) {
    body.tags = [LEAD_TAG];
  }
  return body;
}

/**
 * Process a single row: dedupe by email, create or tag.
 * Returns 'created' | 'updated' on success, throws on failure.
 */
async function processRow(row: LeadBitesRow): Promise<'created' | 'updated'> {
  const existing = await findContactByEmail(row.email);

  if (existing) {
    // Existing contact — preserve tags, add LEAD_TAG if missing
    if (existing.tags.includes(LEAD_TAG)) {
      // Already tagged; nothing to do, but report as updated for visibility
      return 'updated';
    }
    const newTags = [...existing.tags, LEAD_TAG];
    const patchRes = await fetch(`${BASE_URL}/api/contacts/${existing.id}/edit`, {
      method: 'PATCH',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ tags: newTags }),
    });
    if (!patchRes.ok) {
      throw new Error(`Tag PATCH failed: ${patchRes.status} ${(await patchRes.text()).slice(0, 200)}`);
    }
    return 'updated';
  } else {
    // New contact — create with tag inline
    const createRes = await fetch(`${BASE_URL}/api/contacts/new`, {
      method: 'POST',
      headers: {
        Authorization: authHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(rowToContactBody(row, true)),
    });
    if (!createRes.ok) {
      throw new Error(`Create failed: ${createRes.status} ${(await createRes.text()).slice(0, 200)}`);
    }
    return 'created';
  }
}

/**
 * Concurrency-limited batch processor.
 */
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
 * Process a batch of rows. Designed to fit well within Vercel Hobby's 10s timeout.
 * Recommended batch size: 15-20 rows.
 * Each row makes 1-2 Mautic API calls; concurrency 5 keeps total ~5-8s.
 */
export async function processBatch(rows: LeadBitesRow[]): Promise<BatchResult> {
  const results = await pLimit(rows, 5, processRow);

  let created = 0;
  let updated = 0;
  const failures: Array<{ email: string; error: string }> = [];

  for (const r of results) {
    if (r.ok) {
      if (r.value === 'created') created++;
      else updated++;
    } else {
      failures.push({ email: r.item.email, error: r.error });
    }
  }

  return {
    created,
    updated,
    failed: failures.length,
    failures,
  };
}
