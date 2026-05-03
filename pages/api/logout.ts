import type { NextApiRequest, NextApiResponse } from 'next';
import { getSession } from '@/lib/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const session = await getSession(req, res);
  session.destroy();
  return res.status(200).json({ ok: true });
}
