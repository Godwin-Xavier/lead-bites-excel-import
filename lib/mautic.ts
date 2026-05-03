import type { LeadBitesRow } from './csv';

const BASE_URL = (process.env.MAUTIC_BASE_URL || '').replace(/\/$/, '');
const USERNAME = process.env.MAUTIC_USERNAME || '';
const PASSWORD = process.env.MAUTIC_PASSWORD || '';
const LEAD_TAG = process.env.LEAD_TAG || 'lead bites';

if (!BASE_URL || !USERNAME || !PASSWORD) {
  // Don't throw at module load — let the API route handle missing env
  console.warn('Mautic env vars are not fully configured');
}

function authHeader(): string {
  return 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
}

export type MauticContact = {
  id: number;
  email: string;
  tags?: Record<string, { tag: string }> | Array<{ tag: string }>;
};

export type ImportSummary = {
  created: number;
  updated: number;
  failed: number;
  failures: Array<{ email: string; error: string }>;
  durationMs: number;
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
 * Fetch all existing contacts and build a lowercase-email → id map.
 * Used for fast in-memory dedupe before deciding create vs update.
 */
export async function fetchExistingEmailMap(): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const PAGE_SIZE = 1000;
  let start = 0;
  // Mautic's /api/contacts returns up to ~500-1000 at a time; we loop.
  // We only need email + id, so use minimal field selection.
  while (true) {
    const url = new URL(`${BASE_URL}/api/contacts`);
    url.searchParams.set('limit', String(PAGE_SIZE));
    url.searchParams.set('start', String(start));
    url.searchParams.set('orderBy', 'id');
    url.searchParams.set('orderByDir', 'asc');
    // Only fetch the email field to keep payload small
    url.searchParams.set('minimal', '1');

    const res = await fetch(url.toString(), {
      headers: { Authorization: authHeader(), Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Mautic listing failed: ${res.status} ${await res.text()}`);
    }
    const data: any = await res.json();
    const contacts: Record<string, MauticContact> = data.contacts || {};
    const ids = Object.keys(contacts);
    if (ids.length === 0) break;

    for (const id of ids) {
      const c = contacts[id];
      if (c?.email) map.set(c.email.toLowerCase(), Number(c.id));
    }

    if (ids.length < PAGE_SIZE) break;
    start += PAGE_SIZE;

    // Safety: don't loop forever
    if (start > 500000) break;
  }
  return map;
}

/**
 * Convert our cleaned row to a Mautic contact body.
 * Tags are sent as an array of strings; Mautic creates them on-the-fly.
 */
export function rowToMauticBody(row: LeadBitesRow): Record<string, any> {
  return {
    firstname: row.firstName,
    lastname: row.lastName,
    email: row.email,
    position: row.position,
    company: row.organization,
    website: row.website,
    city: row.city,
    state: row.state,
    country: row.country,
    address1: '', // Optional — left empty
    tags: [LEAD_TAG],
    // Custom fields (only used if you've configured them in Mautic)
    industry: row.industries,
    description: row.description,
  };
}

/**
 * Create a single contact. Returns the contact id on success.
 */
export async function createContact(row: LeadBitesRow): Promise<number> {
  const body = rowToMauticBody(row);
  // Don't push tags array via the create-new payload — Mautic 5 batch create handles
  // tags inconsistently. We do tags separately via PATCH.
  const { tags, ...contactData } = body;

  const res = await fetch(`${BASE_URL}/api/contacts/new`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(contactData),
  });
  if (!res.ok) {
    throw new Error(`Create failed: ${res.status} ${await res.text()}`);
  }
  const data: any = await res.json();
  const id = Number(data?.contact?.id);
  if (!id) throw new Error('Mautic returned no contact id');
  // Tag the new contact
  await applyLeadBitesTag(id);
  return id;
}

/**
 * Apply the lead-bites tag to an existing contact, preserving any tags it already has.
 * Uses the fetch-merge-PATCH workaround that the local bot proved reliable.
 */
export async function applyLeadBitesTag(contactId: number): Promise<void> {
  // Fetch current tags
  const fetchRes = await fetch(`${BASE_URL}/api/contacts/${contactId}`, {
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  if (!fetchRes.ok) {
    throw new Error(`Fetch contact ${contactId} failed: ${fetchRes.status}`);
  }
  const data: any = await fetchRes.json();
  const c = data.contact || {};

  let existingTags: string[] = [];
  if (Array.isArray(c.tags)) {
    existingTags = c.tags.map((t: any) => (typeof t === 'string' ? t : t?.tag)).filter(Boolean);
  } else if (c.tags && typeof c.tags === 'object') {
    existingTags = Object.values(c.tags as Record<string, { tag: string }>)
      .map((t: any) => t?.tag)
      .filter(Boolean);
  }

  if (existingTags.includes(LEAD_TAG)) {
    // Already tagged — nothing to do
    return;
  }

  const newTags = [...existingTags, LEAD_TAG];
  const patchRes = await fetch(`${BASE_URL}/api/contacts/${contactId}/edit`, {
    method: 'PATCH',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ tags: newTags }),
  });
  if (!patchRes.ok) {
    throw new Error(`Tag PATCH ${contactId} failed: ${patchRes.status} ${await patchRes.text()}`);
  }
}

/**
 * Concurrency-limited Promise.all helper. Runs `fn` on each `item`, but at most `concurrency` at a time.
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
 * Main import entry point.
 * - For new emails: createContact + tag
 * - For existing emails: just apply the tag (preserves all other Mautic data)
 */
export async function importRows(rows: LeadBitesRow[]): Promise<ImportSummary> {
  const start = Date.now();
  const failures: Array<{ email: string; error: string }> = [];

  // Step 1: build email→id map of existing Mautic contacts
  const existing = await fetchExistingEmailMap();

  // Step 2: split rows into create vs update lists
  const toCreate: LeadBitesRow[] = [];
  const toUpdate: Array<{ row: LeadBitesRow; id: number }> = [];
  for (const row of rows) {
    const id = existing.get(row.email);
    if (id) toUpdate.push({ row, id });
    else toCreate.push(row);
  }

  // Step 3: create new contacts (concurrency 5)
  const createResults = await pLimit(toCreate, 5, createContact);
  const created = createResults.filter((r) => r.ok).length;
  for (const r of createResults) {
    if (!r.ok) failures.push({ email: r.item.email, error: r.error });
  }

  // Step 4: tag existing contacts (concurrency 5)
  const updateResults = await pLimit(toUpdate, 5, async ({ id }) => applyLeadBitesTag(id));
  const updated = updateResults.filter((r) => r.ok).length;
  for (const r of updateResults) {
    if (!r.ok) failures.push({ email: r.item.row.email, error: r.error });
  }

  return {
    created,
    updated,
    failed: failures.length,
    failures: failures.slice(0, 50), // Limit response size
    durationMs: Date.now() - start,
  };
}
