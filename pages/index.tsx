import { useEffect, useRef, useState } from 'react';
import type { GetServerSidePropsContext } from 'next';
import { getSession } from '@/lib/auth';

type LoginProps = { loggedIn: boolean };

export async function getServerSideProps(ctx: GetServerSidePropsContext): Promise<{
  props: LoginProps;
}> {
  const session = await getSession(ctx.req, ctx.res);
  return { props: { loggedIn: !!session.loggedIn } };
}

type ImportSummary = {
  ok: true;
  parse: {
    totalRows: number;
    cleanRows: number;
    skippedRows: number;
    skipReasons: Record<string, number>;
  };
  mautic: {
    created: number;
    updated: number;
    failed: number;
    failures: Array<{ email: string; error: string }>;
    durationMs: number;
  };
};

export default function Home({ loggedIn: initialLoggedIn }: LoginProps) {
  const [loggedIn, setLoggedIn] = useState(initialLoggedIn);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
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
        const data = await res.json();
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
    setResult(null);
    setFile(null);
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploading(true);
    setError('');
    setResult(null);
    setProgress('Reading CSV...');

    try {
      const text = await file.text();
      setProgress(`Parsed ${(text.length / 1024).toFixed(0)} KB. Sending to Mautic...`);

      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || `Upload failed (${res.status})`);
        if (data.summary) setProgress(JSON.stringify(data.summary));
      } else {
        setResult(data);
        setFile(null);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    } catch (e: any) {
      setError(e?.message || 'Network error');
    } finally {
      setUploading(false);
      setProgress('');
    }
  }

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

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Lead Bites Uploader</h1>
            <p className="text-slate-500 mt-1">
              Pushes new leads into Mautic with the <code className="bg-slate-200 px-1 rounded">lead bites</code> tag.
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="text-sm text-slate-600 hover:text-slate-900"
          >
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
              />
              {file && (
                <p className="text-sm text-slate-500 mt-2">
                  Selected: <span className="font-mono">{file.name}</span> (
                  {(file.size / 1024).toFixed(0)} KB)
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={uploading || !file}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-medium py-3 px-4 rounded-md transition"
            >
              {uploading ? 'Importing... (this can take 30-60s)' : 'Import to Mautic'}
            </button>
          </form>

          {progress && (
            <div className="mt-4 text-sm text-slate-600 bg-slate-100 px-3 py-2 rounded">
              {progress}
            </div>
          )}

          {error && (
            <div className="mt-4 text-sm text-red-700 bg-red-50 px-3 py-3 rounded">
              <strong>Error:</strong> {error}
            </div>
          )}
        </div>

        {result && (
          <div className="bg-white rounded-xl shadow-md p-8">
            <h2 className="text-xl font-bold text-slate-900 mb-4">Import complete</h2>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
              <Stat label="CSV rows" value={result.parse.totalRows} />
              <Stat label="Created" value={result.mautic.created} accent="green" />
              <Stat label="Updated" value={result.mautic.updated} accent="blue" />
              <Stat label="Failed" value={result.mautic.failed} accent={result.mautic.failed > 0 ? 'red' : 'gray'} />
            </div>

            <div className="text-sm text-slate-600 mb-4">
              <strong>Skipped {result.parse.skippedRows} rows during parsing:</strong>
              <ul className="ml-4 mt-1 list-disc">
                {Object.entries(result.parse.skipReasons).map(([reason, count]) => (
                  count > 0 && <li key={reason}>{reason}: {count}</li>
                ))}
              </ul>
            </div>

            <div className="text-sm text-slate-600 mb-4">
              Total time: {(result.mautic.durationMs / 1000).toFixed(1)}s
            </div>

            {result.mautic.failures.length > 0 && (
              <details className="mt-4">
                <summary className="text-sm text-slate-700 cursor-pointer hover:text-slate-900">
                  Show {result.mautic.failures.length} failed row{result.mautic.failures.length === 1 ? '' : 's'}
                </summary>
                <ul className="mt-2 text-xs font-mono bg-slate-50 p-3 rounded max-h-64 overflow-auto">
                  {result.mautic.failures.map((f, i) => (
                    <li key={i} className="mb-1">
                      <strong>{f.email}</strong>: {f.error}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div className="mt-6 text-sm text-slate-500 border-t pt-4">
              The Vultr <code className="bg-slate-200 px-1 rounded">marketing-emails</code> service will pick up these new contacts within 5 minutes and start the 5-stage Lead Bites cold-outreach sequence.
            </div>
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
