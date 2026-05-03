import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { password } = (req.body || {}) as { password?: string };
  const expected = process.env.UPLOAD_PASSWORD;

  if (!expected) {
    return res.status(500).json({ error: 'Server is not configured (UPLOAD_PASSWORD missing)' });
  }

  if (!password || password !== expected) {
    // Constant-time-ish: don't reveal which part is wrong
    return res.status(401).json({ error: 'Wrong password' });
  }

  const session = await getSession(req, res);
  session.loggedIn = true;
  await session.save();

  return res.status(200).json({ ok: true });
}
