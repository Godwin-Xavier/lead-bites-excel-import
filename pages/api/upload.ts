import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@/lib/auth';
import { parseLeadBitesCsv, validateColumns } from '@/lib/csv';
import { importRows, testConnection } from '@/lib/mautic';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '8mb',
    },
  },
  // 60s for Pro, 10s for Hobby. We design under 10s for safety.
  maxDuration: 60,
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const session = await getSession(req, res);
  if (!session.loggedIn) {
    return res.status(401).json({ error: 'Not logged in' });
  }

  // Body shape: { csv: string } — sent as JSON from the browser after FileReader
  const { csv } = (req.body || {}) as { csv?: string };
  if (!csv || typeof csv !== 'string') {
    return res.status(400).json({ error: 'Missing csv string in body' });
  }

  // Validate columns
  const colCheck = validateColumns(csv);
  if (!colCheck.ok) {
    return res.status(400).json({
      error: `CSV is missing required columns: ${colCheck.missing.join(', ')}`,
    });
  }

  // Parse + clean
  const parsed = parseLeadBitesCsv(csv);
  if (parsed.rows.length === 0) {
    return res.status(400).json({
      error: 'No valid rows after cleaning',
      summary: {
        totalRows: parsed.totalRows,
        skippedRows: parsed.skippedRows,
        skipReasons: parsed.skipReasons,
      },
    });
  }

  // Quick Mautic connectivity test before doing real work
  const connTest = await testConnection();
  if (!connTest.ok) {
    return res.status(502).json({
      error: `Cannot reach Mautic: ${connTest.message}`,
    });
  }

  // Import
  try {
    const summary = await importRows(parsed.rows);
    return res.status(200).json({
      ok: true,
      parse: {
        totalRows: parsed.totalRows,
        cleanRows: parsed.rows.length,
        skippedRows: parsed.skippedRows,
        skipReasons: parsed.skipReasons,
      },
      mautic: summary,
    });
  } catch (e: any) {
    return res.status(500).json({
      error: e?.message || 'Import failed',
    });
  }
}
