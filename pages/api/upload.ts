import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@/lib/auth';
import { processBatch, testConnection } from '@/lib/mautic';
import type { LeadBitesRow } from '@/lib/csv';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '2mb', // Each batch is small; cap to be safe
    },
  },
  maxDuration: 30, // Pro = 60, Hobby = 10. We're designed for 10s with margin.
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getSession(req, res);
  if (!session.loggedIn) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  const { rows, testOnly } = (req.body || {}) as { rows?: LeadBitesRow[]; testOnly?: boolean };

  // Optional test-connection ping (used by client before starting batches)
  if (testOnly) {
    const t = await testConnection();
    if (!t.ok) return res.status(502).json({ error: `Mautic unreachable: ${t.message}` });
    return res.status(200).json({ ok: true });
  }

  if (!Array.isArray(rows)) {
    return res.status(400).json({ error: 'Body must include `rows` array' });
  }

  if (rows.length === 0) {
    return res.status(200).json({ ok: true, created: 0, updated: 0, failed: 0, failures: [] });
  }

  if (rows.length > 10) {
    return res.status(400).json({
      error: `Batch too large (${rows.length}). Max 10 rows per batch.`,
    });
  }

  try {
    const result = await processBatch(rows);
    return res.status(200).json({ ok: true, ...result });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Batch failed' });
  }
}
