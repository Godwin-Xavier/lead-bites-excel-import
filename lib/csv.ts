import Papa from 'papaparse';

/**
 * The CSV columns we care about from Lead Bites monthly exports.
 * Source CSV has 40 columns; we extract only what we need for Mautic + personalization.
 */
export type LeadBitesRow = {
  organization: string;
  website: string;
  city: string;
  state: string;
  country: string;
  description: string;
  fullDescription: string;
  linkedin: string;
  firstName: string;
  lastName: string;
  position: string;
  email: string;
  decisionMakerLinkedIn: string;
  industries: string;
  companyType: string;
  numberOfEmployees: string;
  techStack: string;
  opportunities: string;
  needsWebsite: string;
};

export type ParseResult = {
  rows: LeadBitesRow[];
  totalRows: number;
  skippedRows: number;
  skipReasons: Record<string, number>;
};

const REQUIRED_COLUMNS = ['Decision Maker Email', 'Decision Maker First Name'];

function cleanString(v: unknown): string {
  if (v === null || v === undefined) return '';
  return String(v).trim();
}

function isValidEmail(email: string): boolean {
  if (!email) return false;
  // Simple but effective: must have @ and a dot in the domain part
  const at = email.indexOf('@');
  if (at <= 0) return false;
  const domain = email.slice(at + 1);
  if (!domain.includes('.') || domain.length < 3) return false;
  // Reject obvious test/junk addresses
  if (email.includes('test.co') || email.includes('example.com')) return false;
  return true;
}

/**
 * Parse a CSV buffer into clean LeadBitesRow objects.
 * Strips BOM, dedupes by email, validates required fields.
 */
export function parseLeadBitesCsv(csvText: string): ParseResult {
  // Strip BOM if present (Lead Bites CSVs typically have one)
  const text = csvText.replace(/^﻿/, '');

  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (result.errors.length > 0) {
    // Continue anyway — most parser errors are non-fatal (e.g., trailing comma)
    console.warn(`CSV parse warnings: ${result.errors.length}`);
  }

  const seenEmails = new Set<string>();
  const skipReasons: Record<string, number> = {
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
      skipReasons.missing_email++;
      continue;
    }
    if (!isValidEmail(email)) {
      skipReasons.invalid_email++;
      continue;
    }
    if (!firstName) {
      skipReasons.missing_first_name++;
      continue;
    }
    if (seenEmails.has(email)) {
      skipReasons.duplicate++;
      continue;
    }
    seenEmails.add(email);

    rows.push({
      organization: cleanString(raw['Organization Name']),
      website: cleanString(raw['Website']),
      city: cleanString(raw['City']),
      state: cleanString(raw['State']),
      country: cleanString(raw['Country']),
      description: cleanString(raw['Description']),
      fullDescription: cleanString(raw['Full Description']),
      linkedin: cleanString(raw['LinkedIn']),
      firstName: firstName.replace(/\b\w/g, (c) => c.toUpperCase()), // Title case
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

  const totalRows = result.data.length;
  const skippedRows = totalRows - rows.length;

  return { rows, totalRows, skippedRows, skipReasons };
}

/**
 * Verify the CSV has the columns we need before parsing.
 */
export function validateColumns(csvText: string): { ok: boolean; missing: string[] } {
  const text = csvText.replace(/^﻿/, '');
  const firstLine = text.split('\n')[0] || '';
  const headers = firstLine.split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const missing = REQUIRED_COLUMNS.filter((req) => !headers.includes(req));
  return { ok: missing.length === 0, missing };
}
