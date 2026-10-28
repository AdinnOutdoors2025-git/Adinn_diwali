import * as XLSX from 'xlsx';
import { BD } from '../types';
import { MAX_ALLOWED_QUANTITY, TYPE_OPTIONS, ClientType } from '../config/distribution';

export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_COLUMNS = ['Client/Vendor Name', 'Mobile Number', 'Email ID', 'Type', 'Requestee Email', 'Allowed Quantity'] as const;

export interface ImportRow {
  index: number;
  name: string;
  mobile: string;
  email: string;
  type: string;
  requestee: string;
  allowedQuantity: number;
  status: 'valid' | 'duplicate' | 'invalid';
  reason: string;
}

const normalizeName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeMobile = (value: string) => { const digits = value.replace(/\D/g, ''); return digits.length > 10 && digits.startsWith('91') ? digits.slice(-10) : digits; };
const header = (value: string) => value.trim().toLowerCase().replace(/[^a-z]/g, '');
const ALIASES: Record<string, string[]> = {
  name: ['clientvendorname', 'clientname', 'vendorname', 'name'],
  mobile: ['mobilenumber', 'mobile', 'phone', 'phonenumber', 'contact'],
  email: ['emailid', 'email', 'emailaddress'],
  type: ['type'],
  requestee: ['requesteeemail', 'requesteename', 'requestee'],
  quantity: ['allowedquantity', 'quantity'],
};

// Reads one cell by any accepted header spelling; the first non-empty alias wins.
const pick = (row: Record<string, unknown>, field: keyof typeof ALIASES): string => {
  const byHeader = new Map(Object.entries(row).map(([key, value]) => [header(key), value]));
  for (const alias of ALIASES[field]) {
    const value = byHeader.get(alias);
    if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
  }
  return '';
};

// Mirrors the backend rules so problems show before importing. The backend still validates every row.
export function parseImportRows(rows: Record<string, unknown>[], bds: BD[]): ImportRow[] {
  const lookup = new Map<string, BD | null>();
  for (const bd of bds) {
    for (const key of [bd.email.toLowerCase(), normalizeName(bd.name)]) lookup.set(key, lookup.has(key) && lookup.get(key)?._id !== bd._id ? null : bd);
  }
  const seen = new Set<string>();
  return rows.map((row, index) => {
    const name = pick(row, 'name'), mobile = pick(row, 'mobile'), email = pick(row, 'email').toLowerCase();
    const type = pick(row, 'type'), requestee = pick(row, 'requestee'), quantityText = pick(row, 'quantity');
    const base = { index: index + 1, name, mobile, email, type, requestee, allowedQuantity: 1 };
    const bad = (reason: string): ImportRow => ({ ...base, status: 'invalid', reason });
    if (!name) return bad('Missing name');
    if (!/^\d{10}$/.test(mobile)) return bad('Phone must be exactly 10 digits (numbers only)');
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return bad('Invalid email');
    const matchedType = TYPE_OPTIONS.find(option => option.toLowerCase() === type.toLowerCase());
    if (!matchedType) return bad(type ? `Unknown type "${type}"` : 'Missing type');
    if (!requestee) return bad('Missing requestee');
    const bd = lookup.get(requestee.toLowerCase()) ?? lookup.get(normalizeName(requestee));
    if (!bd) return bad(lookup.has(requestee.toLowerCase()) || lookup.has(normalizeName(requestee)) ? 'Requestee name is ambiguous - use the email' : `Requestee "${requestee}" not found`);
    let allowedQuantity = 1;
    if (quantityText) {
      allowedQuantity = /^\d+$/.test(quantityText) ? Number(quantityText) : NaN;
      if (!(allowedQuantity >= 1 && allowedQuantity <= MAX_ALLOWED_QUANTITY)) return bad(`Allowed quantity must be 1 to ${MAX_ALLOWED_QUANTITY}`);
    }
    const key = `${normalizeMobile(mobile) || normalizeName(name)}|${matchedType}|${bd._id}`;
    const resolved = { ...base, type: matchedType, requestee: bd.email, allowedQuantity };
    if (seen.has(key)) return { ...resolved, status: 'duplicate', reason: 'Duplicate in file' };
    seen.add(key);
    return { ...resolved, status: 'valid', reason: 'Ready' };
  });
}

export const toImportRecords = (rows: ImportRow[]) => rows.filter(row => row.status === 'valid').map(row => ({
  name: row.name, mobile: row.mobile, email: row.email, type: row.type as ClientType, requestee: row.requestee, allowedQuantity: row.allowedQuantity,
}));

export async function readWorkbookRows(file: File): Promise<Record<string, unknown>[]> {
  const workbook = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return sheet ? XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' }) : [];
}

export function downloadTemplate() {
  const rows = [
    ['Acme Global Media Ltd', '9876543210', 'contact@acmeglobal.com', 'Client', 'requestee@adinn.co.in', 2],
    ['Apex Billboard Enterprises', '9812345678', 'sales@apexenterprise.com', 'Vendor', 'requestee@adinn.co.in', 1],
  ];
  const sheet = XLSX.utils.aoa_to_sheet([[...IMPORT_COLUMNS], ...rows]);
  sheet['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 28 }, { wch: 16 }, { wch: 28 }, { wch: 16 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'Clients_Vendors');
  XLSX.writeFile(book, 'Diwali_Client_Import_Template.xlsx');
}
