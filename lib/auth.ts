import type { IronSessionOptions } from 'iron-session';
import { getIronSession, type SessionOptions } from 'iron-session';
import type { IncomingMessage, ServerResponse } from 'http';
import type { NextApiRequest, NextApiResponse } from 'next';

export type SessionData = {
  loggedIn?: boolean;
};

export const sessionOptions: SessionOptions = {
  password: process.env.SESSION_PASSWORD || 'fallback-do-not-use-in-prod-fallback-do-not-use-in-prod',
  cookieName: 'lead-bites-uploader',
  cookieOptions: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 8, // 8 hours
  },
};

export async function getSession(
  req: IncomingMessage | NextApiRequest,
  res: ServerResponse | NextApiResponse,
) {
  return getIronSession<SessionData>(req, res, sessionOptions);
}
