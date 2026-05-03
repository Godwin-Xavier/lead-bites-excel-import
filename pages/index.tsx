import { useEffect, useRef, useState } from 'react';
import type { GetServerSidePropsContext } from 'next';
import Papa from 'papaparse';
import { getSession } from '@/lib/auth';
import type { LeadBitesRow } from '@/lib/csv';

type LoginProps = { loggedIn: boolean };

export async function getServerSideProps(ctx: GetServerSidePropsContext): Promise<{
  props: LoginProps;
}> {
  const session = await getSession(ctx.req, ctx.res);
  return { props: { loggedIn: !!session.loggedIn } };
}

const BATCH_SIZE = 15; // Designed to fit Vercel Hobby's 10s function timeout

type RunningTotals = {
  totalRows: number;
  cleanRows: number;
  skipped: Record<string, number>;
  created: number;
  updated: number;
  failed: number;
  failures: Array<{ email: string; error: string }>;
  batchesDone: number;
  batchesTotal: number;
  startedAt: number;
};

function cleanString(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function isValidEmail(email: string): boolean {
  if (!email) return false;
  const at = email.indexOf('@');
  if (at <= 0) return false;
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.length < 3) return false;
  if (email.includes('test.co') || email.includes('example.com')) return false;
  return true;
}

function parseCsvInBrowser(text: string): {
  rows: LeadBitesRow[];
  totalRows: number;
  skipped: Record<string, number>;
  missingColumns: string[];
} {
  const cleanText = text.replace(/^﻿/, '');
  const result = Papa.parse<Record<string, string>>(cleanText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const REQUIRED = ['Decision Maker Email', 'Decision Maker First Name'];
  const headers = (result.meta.fields || []).map((h) => h.trim());
  const missingColumns = REQUIRED.filter((c) => !headers.includes(c));
  if (missingColumns.length > 0) {
    return { rows: [], totalRows: 0, skipped: {}, missingColumns };
  }

  const seen = new Set<string>();
  const skipped: Record<string, number> = {
    duplicate: 0,
    missing_email: 0,
    invalid_email: 0,
    missing_first_name: 0,
  };
  const rows: LeadBitesRow[] = [];

  for (const raw of result.data) {
    const email = cleanString(raw['Decision Maker Email']).toLowerCase();
    const firstName = cleanString(raw['Decision Maker First Name']);
    if (!email) {
      skipped.missing_email++;
      continue;
    }
    if (!isValidEmail(email)) {
      skipped.invalid_email++;
      continue;
    }
    if (!firstName) {
      skipped.missing_first_name++;
      continue;
    }
    if (seen.has(email)) {
      skipped.duplicate++;
      continue;
    }
    seen.add(email);

    rows.push({
      organization: cleanString(raw['Organization Name']),
      website: cleanString(raw['Website']),
      city: cleanString(raw['City']),
      state: cleanString(raw['State']),
      country: cleanString(raw['Country']),
      description: cleanString(raw['Description']),
      fullDescription: cleanString(raw['Full Description']),
      linkedin: cleanString(raw['LinkedIn']),
      firstName: firstName.replace(/\b\w/g, (c) => c.toUpperCase()),
      lastName: cleanString(raw['Decision Maker Last Name']).replace(/\b\w/g, (c) => c.toUpperCase()),
      position: cleanString(raw['Decision Maker Position']),
      email,
      decisionMakerLinkedIn: cleanString(raw['Decision Maker LinkedIn URL']),
      industries: cleanString(raw['Industries']),
      companyType: cleanString(raw['Company Type']),
      numberOfEmployees: cleanString(raw['Number of Employees']),
      techStack: cleanString(raw['Tech Stack']),
      opportunities: cleanString(raw['Opportunities']),
      needsWebsite: cleanString(raw['Needs Website']),
    });
  }

  return { rows, totalRows: result.data.length, skipped, missingColumns: [] };
}

export default function Home({ loggedIn: initialLoggedIn }: LoginProps) {
  const [loggedIn, setLoggedIn] = useState(initialLoggedIn);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [totals, setTotals] = useState<RunningTotals | null>(null);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        setLoggedIn(true);
        setPassword('');
      } else {
        const data = await res.json().catch(() => ({}));
        setAuthError(data.error || 'Login failed');
      }
    } catch (e: any) {
      setAuthError(e?.message || 'Network error');
    } finally {
      setAuthLoading(false);
    }
  }

  async function handleLogout() {
    await fetch('/api/logout', { method: 'POST' });
    setLoggedIn(false);
    setTotals(null);
    setFile(null);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError('');
    setRunning(true);
    setTotals(null);

    try {
      // Step 1: Read & parse CSV in browser
      const text = await file.text();
      const parsed = parseCsvInBrowser(text);

      if (parsed.missingColumns.length > 0) {
        setError(`CSV is missing required columns: ${parsed.missingColumns.join(', ')}`);
        setRunning(false);
        return;
      }
      if (parsed.rows.length === 0) {
        setError(
          `No valid rows after cleaning ${parsed.totalRows} input rows. Check the CSV format.`,
        );
        setRunning(false);
        return;
      }

      const batchesTotal = Math.ceil(parsed.rows.length / BATCH_SIZE);
      const initial: RunningTotals = {
        totalRows: parsed.totalRows,
        cleanRows: parsed.rows.length,
        skipped: parsed.skipped,
        created: 0,
        updated: 0,
        failed: 0,
        failures: [],
        batchesDone: 0,
        batchesTotal,
        startedAt: Date.now(),
      };
      setTotals(initial);

      // Step 2: Test Mautic connection before starting (fail fast)
      const testRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testOnly: true }),
      });
      if (!testRes.ok) {
        const data = await testRes.json().catch(() => ({}));
        throw new Error(data.error || 'Mautic connection test failed');
      }

      // Step 3: Process batches sequentially
      let running = initial;
      for (let i = 0; i < batchesTotal; i++) {
        const batch = parsed.rows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rows: batch }),
        });

        let data: any = null;
        try {
          data = await res.json();
        } catch {
          data = { error: `Batch ${i + 1} returned non-JSON response (HTTP ${res.status})` };
        }

        if (!res.ok || !data.ok) {
          // Add the whole batch as failures so we don't lose visibility
          running = {
            ...running,
            failed: running.failed + batch.length,
            failures: [
              ...running.failures,
              ...batch.slice(0, 5).map((r) => ({
                email: r.email,
                error: data.error || `Batch ${i + 1} failed (HTTP ${res.status})`,
              })),
            ],
            batchesDone: i + 1,
          };
        } else {
          running = {
            ...running,
            created: running.created + (data.created || 0),
            updated: running.updated + (data.updated || 0),
            failed: running.failed + (data.failed || 0),
            failures: [...running.failures, ...(data.failures || [])].slice(0, 100),
            batchesDone: i + 1,
          };
        }
        setTotals({ ...running });
      }

      // Done — clear file selector
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
    } finally {
      setRunning(false);
    }
  }

  // -------- LOGIN --------
  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-md p-8">
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Lead Bites Uploader</h1>
          <p className="text-slate-500 text-sm mb-6">
            Enter the password to upload Lead Bites CSVs into Mautic.
          </p>
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                required
              />
            </div>
            {authError && (
              <div className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded">{authError}</div>
            )}
            <button
              type="submit"
              disabled={authLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2 px-4 rounded-md transition"
            >
              {authLoading ? 'Logging in...' : 'Log in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // -------- UPLOAD UI --------
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Lead Bites Uploader</h1>
            <p className="text-slate-500 mt-1">
              Pushes new leads into Mautic with the{' '}
              <code className="bg-slate-200 px-1 rounded">lead bites</code> tag.
            </p>
          </div>
          <button onClick={handleLogout} className="text-sm text-slate-600 hover:text-slate-900">
            Log out
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-md p-8 mb-6">
          <form onSubmit={handleUpload} className="space-y-4">
            <div>
              <label htmlFor="csv" className="block text-sm font-medium text-slate-700 mb-2">
                Lead Bites CSV file
              </label>
              <input
                ref={fileInputRef}
                id="csv"
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="block w-full text-sm text-slate-600 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                required
                disabled={running}
              />
              {file && (
                <p className="text-sm text-slate-500 mt-2">
                  Selected: <span className="font-mono">{file.name}</span> ({(file.size / 1024).toFixed(0)}{' '}
                  KB)
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={running || !file}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-3 px-4 rounded-md transition"
            >
              {running ? 'Importing...' : 'Import to Mautic'}
            </button>
          </form>

          {error && (
            <div className="mt-4 text-sm text-red-700 bg-red-50 px-3 py-3 rounded">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>

        {totals && (
          <div className="bg-white rounded-xl shadow-md p-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-900">
                {totals.batchesDone === totals.batchesTotal && !running ? 'Done' : 'In progress'}
              </h2>
              <span className="text-sm text-slate-500">
                Batch {totals.batchesDone} / {totals.batchesTotal}
              </span>
            </div>

            {/* Progress bar */}
            <div className="w-full bg-slate-100 rounded-full h-2 mb-6">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all"
                style={{
                  width: `${totals.batchesTotal === 0 ? 0 : (totals.batchesDone / totals.batchesTotal) * 100}%`,
                }}
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <Stat label="CSV rows" value={totals.totalRows} />
              <Stat label="Created" value={totals.created} accent="green" />
              <Stat label="Updated" value={totals.updated} accent="blue" />
              <Stat
                label="Failed"
                value={totals.failed}
                accent={totals.failed > 0 ? 'red' : 'gray'}
              />
            </div>

            {totals.totalRows !== totals.cleanRows && (
              <div className="text-sm text-slate-600 mb-4 bg-amber-50 px-3 py-2 rounded">
                <strong>{totals.totalRows - totals.cleanRows}</strong> rows skipped during parsing:{' '}
                {Object.entries(totals.skipped)
                  .filter(([_, v]) => v > 0)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}
              </div>
            )}

            <div className="text-sm text-slate-600 mb-4">
              Elapsed: {((Date.now() - totals.startedAt) / 1000).toFixed(0)}s
            </div>

            {totals.failures.length > 0 && (
              <details className="mt-4">
                <summary className="text-sm text-slate-700 cursor-pointer hover:text-slate-900">
                  Show {totals.failures.length} failed row{totals.failures.length === 1 ? '' : 's'}
                </summary>
                <ul className="mt-2 text-xs font-mono bg-slate-50 p-3 rounded max-h-64 overflow-auto">
                  {totals.failures.map((f, i) => (
                    <li key={i} className="mb-1 break-all">
                      <strong>{f.email}</strong>: {f.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {totals.batchesDone === totals.batchesTotal && !running && (
              <div className="mt-6 text-sm text-slate-500 border-t pt-4">
                The Vultr <code className="bg-slate-200 px-1 rounded">marketing-emails</code> service will
                pick up these new contacts within 5 minutes and start the 5-stage Lead Bites cold-outreach
                sequence.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent = 'gray',
}: {
  label: string;
  value: number;
  accent?: 'gray' | 'green' | 'blue' | 'red';
}) {
  const colors = {
    gray: 'text-slate-900',
    green: 'text-green-700',
    blue: 'text-blue-700',
    red: 'text-red-700',
  };
  return (
    <div className="bg-slate-50 rounded-lg p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className={`text-3xl font-bold ${colors[accent]}`}>{value}</div>
    </div>
  );
}
