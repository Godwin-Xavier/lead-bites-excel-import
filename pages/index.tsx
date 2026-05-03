import { useEffect, useRef, useState } from 'react';
import type { GetServerSidePropsContext } from 'next';
import Papa from 'papaparse';
import {
  Upload,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  Database,
  RefreshCw,
  Square,
  Lock,
  LogOut,
  History,
  Activity,
  AlertTriangle,
  Trash2,
} from 'lucide-react';
import { getSession } from '@/lib/auth';
import type { LeadBitesRow } from '@/lib/csv';

type LoginProps = { loggedIn: boolean };

export async function getServerSideProps(ctx: GetServerSidePropsContext): Promise<{
  props: LoginProps;
}> {
  const session = await getSession(ctx.req, ctx.res);
  return { props: { loggedIn: !!session.loggedIn } };
}

const BATCH_SIZE = 5; // small batches keep us well under Vercel Hobby 10s timeout even when Mautic is slow
const HISTORY_KEY = 'lead-bites-history-v1';
const MAX_HISTORY = 10;

type RunStatus = 'idle' | 'parsing' | 'running' | 'cancelled' | 'done' | 'error';

type RunState = {
  status: RunStatus;
  fileName: string;
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
  endedAt: number | null;
};

type HistoryEntry = {
  fileName: string;
  totalRows: number;
  cleanRows: number;
  created: number;
  updated: number;
  failed: number;
  startedAt: number;
  durationMs: number;
  status: 'done' | 'cancelled' | 'error';
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m ${s}s`;
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function Home({ loggedIn: initialLoggedIn }: LoginProps) {
  const [loggedIn, setLoggedIn] = useState(initialLoggedIn);
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const [file, setFile] = useState<File | null>(null);
  const [run, setRun] = useState<RunState | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [tick, setTick] = useState(0); // forces re-render every second for ETA
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cancelRef = useRef(false);

  // Load history from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch {
      // ignore
    }
  }, []);

  // Tick clock while running for live ETA
  useEffect(() => {
    if (run?.status !== 'running') return;
    const i = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(i);
  }, [run?.status]);

  function pushHistory(entry: HistoryEntry) {
    setHistory((prev) => {
      const next = [entry, ...prev].slice(0, MAX_HISTORY);
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }

  function clearHistory() {
    setHistory([]);
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // ignore
    }
  }

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
    setRun(null);
    setFile(null);
  }

  function handleStop() {
    cancelRef.current = true;
    setRun((prev) => (prev ? { ...prev, status: 'cancelled' } : prev));
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file || run?.status === 'running') return;

    setError('');
    cancelRef.current = false;

    const initialRun: RunState = {
      status: 'parsing',
      fileName: file.name,
      totalRows: 0,
      cleanRows: 0,
      skipped: {},
      created: 0,
      updated: 0,
      failed: 0,
      failures: [],
      batchesDone: 0,
      batchesTotal: 0,
      startedAt: Date.now(),
      endedAt: null,
    };
    setRun(initialRun);

    try {
      // Parse CSV
      const text = await file.text();
      const parsed = parseCsvInBrowser(text);

      if (parsed.missingColumns.length > 0) {
        setError(`CSV missing required columns: ${parsed.missingColumns.join(', ')}`);
        setRun({ ...initialRun, status: 'error', endedAt: Date.now() });
        return;
      }
      if (parsed.rows.length === 0) {
        setError(`No valid rows after cleaning ${parsed.totalRows} input rows`);
        setRun({ ...initialRun, status: 'error', endedAt: Date.now() });
        return;
      }

      const batchesTotal = Math.ceil(parsed.rows.length / BATCH_SIZE);

      // Test Mautic connection first
      const testRes = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testOnly: true }),
      });
      if (!testRes.ok) {
        const data = await testRes.json().catch(() => ({}));
        throw new Error(data.error || 'Mautic connection test failed');
      }

      // Pause marketing-emails on the VPS (frees Mautic CPU during import).
      // Best-effort: failures don't abort the upload.
      try {
        await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'pause' }),
        });
      } catch {
        /* non-fatal */
      }

      let running: RunState = {
        ...initialRun,
        status: 'running',
        totalRows: parsed.totalRows,
        cleanRows: parsed.rows.length,
        skipped: parsed.skipped,
        batchesTotal,
      };
      setRun(running);

      // Process batches with retry-on-504 (Mautic can be slow if marketing-emails is busy)
      for (let i = 0; i < batchesTotal; i++) {
        if (cancelRef.current) break;

        const batch = parsed.rows.slice(i * BATCH_SIZE, (i + 1) * BATCH_SIZE);

        let attempt = 0;
        let res: Response | null = null;
        let data: any = null;
        const MAX_ATTEMPTS = 3;
        while (attempt < MAX_ATTEMPTS) {
          attempt++;
          if (cancelRef.current) break;
          try {
            res = await fetch('/api/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ rows: batch }),
            });
            try {
              data = await res.json();
            } catch {
              data = { error: `HTTP ${res.status} (non-JSON, likely upstream timeout)` };
            }
            if (res.ok && data?.ok) break;
            // Retry on 504 (gateway timeout) and 502 (bad gateway)
            if ((res.status === 504 || res.status === 502) && attempt < MAX_ATTEMPTS) {
              // Wait 5s, 15s before next try
              await new Promise((r) => setTimeout(r, attempt * 5000));
              continue;
            }
            break;
          } catch (e: any) {
            data = { error: e?.message || 'Network error' };
            if (attempt < MAX_ATTEMPTS) {
              await new Promise((r) => setTimeout(r, attempt * 5000));
              continue;
            }
            break;
          }
        }

        if (!res || !res.ok || !data?.ok) {
          running = {
            ...running,
            failed: running.failed + batch.length,
            failures: [
              ...running.failures,
              ...batch.slice(0, 3).map((r) => ({
                email: r.email,
                error: data?.error || `Batch ${i + 1} failed (HTTP ${res?.status ?? 0})`,
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
            failures: [...running.failures, ...(data.failures || [])].slice(0, 200),
            batchesDone: i + 1,
          };
        }
        setRun({ ...running });
      }

      // Resume marketing-emails on the VPS (whether finished, cancelled, or errored).
      // Best-effort: failures don't matter, marketing-emails will eventually be
      // resumed manually if this fails.
      try {
        await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'resume' }),
        });
      } catch {
        /* non-fatal */
      }

      const final: RunState = {
        ...running,
        status: cancelRef.current ? 'cancelled' : 'done',
        endedAt: Date.now(),
      };
      setRun(final);
      pushHistory({
        fileName: final.fileName,
        totalRows: final.totalRows,
        cleanRows: final.cleanRows,
        created: final.created,
        updated: final.updated,
        failed: final.failed,
        startedAt: final.startedAt,
        durationMs: (final.endedAt || Date.now()) - final.startedAt,
        status: final.status === 'done' ? 'done' : final.status === 'cancelled' ? 'cancelled' : 'error',
      });

      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: any) {
      setError(e?.message || 'Upload failed');
      setRun((prev) => (prev ? { ...prev, status: 'error', endedAt: Date.now() } : prev));
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && (f.name.endsWith('.csv') || f.type === 'text/csv')) {
      setFile(f);
    }
  }

  // ----------------- LOGIN -----------------
  if (!loggedIn) {
    return (
      <div className="dashboard-bg flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
                <Database className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-900">Lead Bites Uploader</h1>
                <p className="text-xs text-slate-500">Mautic contact import</p>
              </div>
            </div>
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-slate-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-10 pr-3 py-2.5 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    autoFocus
                    required
                  />
                </div>
              </div>
              {authError && (
                <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 px-3 py-2 rounded-lg border border-red-200">
                  <XCircle className="w-4 h-4 flex-shrink-0" />
                  {authError}
                </div>
              )}
              <button
                type="submit"
                disabled={authLoading}
                className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white font-medium py-2.5 px-4 rounded-lg transition-colors"
              >
                {authLoading ? 'Logging in...' : 'Sign in'}
              </button>
            </form>
          </div>
          <p className="text-center text-xs text-slate-400 mt-6">
            Anti-Gravity / Dynamix Solutions
          </p>
        </div>
      </div>
    );
  }

  // ----------------- DASHBOARD -----------------
  const isRunning = run?.status === 'running';
  const isParsing = run?.status === 'parsing';
  const isWorking = isRunning || isParsing;

  // ETA calc
  let etaText = '';
  if (run && isRunning && run.batchesDone > 0) {
    const elapsed = (Date.now() + tick * 0) - run.startedAt; // tick forces re-render
    const perBatch = elapsed / run.batchesDone;
    const remaining = (run.batchesTotal - run.batchesDone) * perBatch;
    etaText = `~${formatDuration(remaining)} remaining`;
  }

  return (
    <div className="dashboard-bg">
      {/* Top bar */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
              <Database className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">Lead Bites Uploader</h1>
              <p className="text-xs text-slate-500">mautic.dynamixsolutions.org</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-100"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Stats grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <StatCard
            icon={<FileText className="w-5 h-5" />}
            label="CSV rows"
            value={run?.totalRows ?? 0}
            color="slate"
            running={isWorking}
          />
          <StatCard
            icon={<CheckCircle2 className="w-5 h-5" />}
            label="Created"
            value={run?.created ?? 0}
            color="green"
            running={isWorking}
          />
          <StatCard
            icon={<RefreshCw className="w-5 h-5" />}
            label="Updated"
            value={run?.updated ?? 0}
            color="blue"
            running={isWorking}
          />
          <StatCard
            icon={<XCircle className="w-5 h-5" />}
            label="Failed"
            value={run?.failed ?? 0}
            color={run && run.failed > 0 ? 'red' : 'slate'}
            running={isWorking}
          />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Left column: upload + progress */}
          <div className="lg:col-span-2 space-y-6">
            {/* Upload card */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Upload className="w-5 h-5 text-slate-700" />
                  <h2 className="text-lg font-semibold text-slate-900">Upload CSV</h2>
                </div>
                {isWorking && (
                  <button
                    onClick={handleStop}
                    className="flex items-center gap-1.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 px-3 py-1.5 rounded-lg border border-red-200 transition-colors"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Stop import
                  </button>
                )}
              </div>

              <form onSubmit={handleUpload}>
                <label
                  htmlFor="csv"
                  className={`block border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
                    dragOver ? 'drop-active' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
                  } ${isWorking ? 'opacity-60 pointer-events-none' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(true);
                  }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={handleDrop}
                >
                  <input
                    ref={fileInputRef}
                    id="csv"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(e) => setFile(e.target.files?.[0] || null)}
                    className="hidden"
                    disabled={isWorking}
                  />
                  <Upload className="w-10 h-10 text-slate-400 mx-auto mb-3" />
                  {file ? (
                    <div>
                      <p className="text-sm font-medium text-slate-900">{file.name}</p>
                      <p className="text-xs text-slate-500 mt-1">
                        {(file.size / 1024).toFixed(0)} KB · click to change
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        Drop CSV here or click to browse
                      </p>
                      <p className="text-xs text-slate-500 mt-1">Lead Bites monthly export · max ~5 MB</p>
                    </div>
                  )}
                </label>

                <button
                  type="submit"
                  disabled={isWorking || !file}
                  className="w-full mt-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-medium py-3 px-4 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {isParsing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Parsing CSV...
                    </>
                  ) : isRunning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Import to Mautic
                    </>
                  )}
                </button>
              </form>

              {error && (
                <div className="mt-4 flex items-start gap-2 text-sm text-red-700 bg-red-50 px-3 py-3 rounded-lg border border-red-200">
                  <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <div>
                    <strong>Error:</strong> {error}
                  </div>
                </div>
              )}
            </div>

            {/* Progress card */}
            {run && run.status !== 'idle' && (
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <Activity className="w-5 h-5 text-slate-700" />
                    <h2 className="text-lg font-semibold text-slate-900">
                      {run.status === 'parsing' && 'Parsing'}
                      {run.status === 'running' && 'Importing'}
                      {run.status === 'cancelled' && 'Cancelled'}
                      {run.status === 'done' && 'Complete'}
                      {run.status === 'error' && 'Failed'}
                    </h2>
                    <StatusBadge status={run.status} />
                  </div>
                  <div className="text-sm text-slate-500">
                    Batch {run.batchesDone}{run.batchesTotal > 0 && ` / ${run.batchesTotal}`}
                  </div>
                </div>

                {/* Progress bar */}
                <div className="w-full bg-slate-100 rounded-full h-2.5 mb-4 overflow-hidden">
                  <div
                    className={`h-2.5 rounded-full transition-all duration-300 ${
                      run.status === 'cancelled'
                        ? 'bg-amber-500'
                        : run.status === 'error'
                        ? 'bg-red-500'
                        : run.status === 'done'
                        ? 'bg-green-500'
                        : 'bg-blue-500'
                    }`}
                    style={{
                      width: `${run.batchesTotal === 0 ? 0 : (run.batchesDone / run.batchesTotal) * 100}%`,
                    }}
                  />
                </div>

                <div className="flex items-center justify-between text-sm text-slate-600">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    Elapsed: {formatDuration((run.endedAt ?? Date.now()) - run.startedAt)}
                  </div>
                  {etaText && <div className="text-slate-500">{etaText}</div>}
                </div>

                {run.totalRows !== run.cleanRows && run.cleanRows > 0 && (
                  <div className="mt-4 flex items-start gap-2 text-sm text-amber-800 bg-amber-50 px-3 py-2.5 rounded-lg border border-amber-200">
                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      <strong>{run.totalRows - run.cleanRows}</strong> rows skipped during parsing:
                      {' '}
                      {Object.entries(run.skipped)
                        .filter(([_, v]) => v > 0)
                        .map(([k, v]) => `${k.replace('_', ' ')}: ${v}`)
                        .join(' · ')}
                    </div>
                  </div>
                )}

                {run.status === 'done' && (
                  <div className="mt-4 flex items-start gap-2 text-sm text-emerald-800 bg-emerald-50 px-3 py-2.5 rounded-lg border border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    <div>
                      The Vultr <code className="bg-emerald-100 px-1 rounded text-xs">marketing-emails</code>{' '}
                      service will pick up these contacts within 5 minutes and start the 5-stage cold-outreach sequence.
                    </div>
                  </div>
                )}

                {run.failures.length > 0 && (
                  <details className="mt-4">
                    <summary className="text-sm font-medium text-slate-700 cursor-pointer hover:text-slate-900 select-none">
                      Show {run.failures.length} failed row{run.failures.length === 1 ? '' : 's'}
                    </summary>
                    <ul className="mt-3 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg p-3 max-h-64 overflow-auto space-y-1.5">
                      {run.failures.map((f, i) => (
                        <li key={i} className="break-all text-slate-700">
                          <strong className="text-red-700">{f.email}</strong>: {f.error}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </div>

          {/* Right column: history */}
          <div className="space-y-6">
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-slate-700" />
                  <h2 className="text-lg font-semibold text-slate-900">Recent imports</h2>
                </div>
                {history.length > 0 && (
                  <button
                    onClick={clearHistory}
                    className="text-xs text-slate-500 hover:text-red-600 flex items-center gap-1"
                    title="Clear history"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {history.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-6">
                  No imports yet
                </p>
              ) : (
                <div className="space-y-3 max-h-[500px] overflow-auto">
                  {history.map((h, i) => (
                    <div
                      key={i}
                      className="border border-slate-200 rounded-lg p-3 hover:bg-slate-50 transition-colors"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <FileText className="w-4 h-4 text-slate-400 flex-shrink-0" />
                          <span className="text-sm font-medium text-slate-900 truncate">
                            {h.fileName}
                          </span>
                        </div>
                        <StatusBadge status={h.status} />
                      </div>
                      <div className="text-xs text-slate-500 ml-6">
                        {formatDate(h.startedAt)} · {formatDuration(h.durationMs)}
                      </div>
                      <div className="ml-6 mt-2 flex gap-3 text-xs">
                        <span className="text-slate-600">{h.totalRows} rows</span>
                        <span className="text-emerald-700">+{h.created}</span>
                        <span className="text-blue-700">~{h.updated}</span>
                        {h.failed > 0 && <span className="text-red-700">×{h.failed}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Help card */}
            <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-2">How it works</h3>
              <ol className="text-xs text-slate-700 space-y-1.5 list-decimal list-inside">
                <li>CSV parsed & deduped in browser</li>
                <li>Sent to Mautic in batches of {BATCH_SIZE} rows</li>
                <li>New emails → contact created with <code className="bg-white px-1 rounded">lead bites</code> tag</li>
                <li>Existing emails → tag added (other tags preserved)</li>
                <li>Vultr scheduler starts emails within 5 min</li>
              </ol>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
  running,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  color: 'slate' | 'green' | 'blue' | 'red';
  running?: boolean;
}) {
  const colorMap = {
    slate: { bg: 'bg-slate-100', text: 'text-slate-700', value: 'text-slate-900' },
    green: { bg: 'bg-green-100', text: 'text-green-700', value: 'text-green-700' },
    blue: { bg: 'bg-blue-100', text: 'text-blue-700', value: 'text-blue-700' },
    red: { bg: 'bg-red-100', text: 'text-red-700', value: 'text-red-700' },
  };
  const c = colorMap[color];
  return (
    <div className={`bg-white rounded-2xl shadow-sm border border-slate-200 p-5 ${running && color !== 'slate' ? 'pulse-while-running' : ''}`}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`w-8 h-8 rounded-lg ${c.bg} ${c.text} flex items-center justify-center`}>
          {icon}
        </div>
      </div>
      <div className={`text-3xl font-bold ${c.value}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    parsing: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Parsing' },
    running: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Running' },
    done: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Done' },
    cancelled: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Cancelled' },
    error: { bg: 'bg-red-100', text: 'text-red-700', label: 'Error' },
    idle: { bg: 'bg-slate-100', text: 'text-slate-700', label: 'Idle' },
  };
  const m = map[status] || map.idle;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${m.bg} ${m.text}`}>
      {m.label}
    </span>
  );
}
