import React, { useCallback, useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Loader2, UploadCloud, XCircle } from 'lucide-react';
import { Modal } from './Modal';
import { api } from '../services/api';
import { BD } from '../types';
import { IMPORT_COLUMNS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS, ImportRow, downloadTemplate, parseImportRows, readWorkbookRows, toImportRecords } from '../utils/excelImport';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  bds: BD[];
  onImported: () => void;
}

interface Result { successful: number; duplicates: number; invalid: number; errors: string[] }

const chip = (tone: string) => `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${tone}`;

// Drop an Excel/CSV file anywhere in the drop zone. Each row names its own Type and Requestee.
export const ExcelImportModal: React.FC<Props> = ({ isOpen, onClose, bds, onImported }) => {
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => { setRows([]); setFileName(''); setError(''); setResult(null); };
  const close = () => { if (importing) return; reset(); onClose(); };

  const load = useCallback(async (file: File | undefined) => {
    if (!file) return;
    reset();
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) { setError('Please choose an Excel (.xlsx, .xls) or CSV file.'); return; }
    if (file.size > IMPORT_MAX_BYTES) { setError('That file is larger than 5 MB.'); return; }
    setParsing(true);
    try {
      const raw = await readWorkbookRows(file);
      if (!raw.length) { setError('The first sheet is empty.'); return; }
      if (raw.length > IMPORT_MAX_ROWS) { setError(`Import at most ${IMPORT_MAX_ROWS} rows at a time.`); return; }
      setFileName(file.name); setRows(parseImportRows(raw, bds));
    } catch { setError('Could not read that file. Check that it is a valid Excel or CSV file.'); }
    finally { setParsing(false); if (input.current) input.current.value = ''; }
  }, [bds]);

  const counts = { valid: rows.filter(row => row.status === 'valid').length, duplicate: rows.filter(row => row.status === 'duplicate').length, invalid: rows.filter(row => row.status === 'invalid').length };
  const runImport = async () => {
    setImporting(true); setError('');
    try {
      const response = await api.bulkImportClients(toImportRecords(rows));
      setResult({ ...response.summary, errors: response.errors || [] });
      onImported();
    } catch (failure: any) { setError(failure.message || 'Import failed. Nothing was changed for rows that were not reported as imported.'); }
    finally { setImporting(false); }
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title="Import from Excel" subtitle="Drop a file with each client's Type and Requestee. Importing does not record any distribution.">
      <div className="space-y-4">
        {error && <p role="alert" className="text-xs text-rose-700 bg-rose-50 p-3 rounded-lg">{error}</p>}

        {result ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2" role="status">
              <span className={chip('bg-emerald-50 text-emerald-700')}><CheckCircle2 className="w-3.5 h-3.5" />{result.successful} imported</span>
              <span className={chip('bg-amber-50 text-amber-800')}>{result.duplicates} duplicates skipped</span>
              <span className={chip('bg-rose-50 text-rose-700')}>{result.invalid} invalid</span>
            </div>
            {result.errors.length > 0 && <ul className="max-h-40 overflow-y-auto text-xs text-slate-600 space-y-1 bg-slate-50 rounded-lg p-3">{result.errors.map((message, index) => <li key={index}>{message}</li>)}</ul>}
            <div className="flex justify-end pt-3 border-t border-slate-100"><button type="button" onClick={close} className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700">Done</button></div>
          </div>
        ) : !rows.length ? (
          <>
            <div role="button" tabIndex={0} aria-label="Drop an Excel file here or press Enter to browse"
              onClick={() => input.current?.click()} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); input.current?.click(); } }}
              onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
              onDrop={event => { event.preventDefault(); setDragging(false); load(event.dataTransfer.files?.[0]); }}
              className={`flex flex-col items-center justify-center gap-2 px-6 py-12 text-center rounded-xl border-2 border-dashed cursor-pointer transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${dragging ? 'border-amber-500 bg-amber-50' : 'border-slate-300 bg-slate-50 hover:border-amber-400 hover:bg-amber-50/40'}`}>
              {parsing ? <Loader2 className="w-9 h-9 text-amber-600 animate-spin" /> : <UploadCloud className="w-9 h-9 text-amber-600" aria-hidden="true" />}
              <p className="text-sm font-bold text-slate-800">{parsing ? 'Reading file...' : 'Drop your Excel file here'}</p>
              <p className="text-xs text-slate-500">or click to browse &middot; .xlsx, .xls or .csv &middot; up to 5 MB</p>
              <input ref={input} type="file" aria-label="Excel file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={event => load(event.target.files?.[0])} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
              <span>Columns (* required): {IMPORT_COLUMNS.map((column, index) => <code key={column} className="font-mono text-slate-700">{column}{index < 2 || index > 2 && index < 5 ? ' *' : ''}{index < IMPORT_COLUMNS.length - 1 ? ', ' : ''}</code>)}</span>
              <button type="button" onClick={downloadTemplate} className="inline-flex items-center gap-1.5 font-semibold text-amber-700 hover:text-amber-800"><Download className="w-3.5 h-3.5" />Download template</button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2" role="status">
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700"><FileSpreadsheet className="w-4 h-4 text-amber-600" />{fileName}</span>
              <span className={chip('bg-emerald-50 text-emerald-700')}>{counts.valid} ready</span>
              {counts.duplicate > 0 && <span className={chip('bg-amber-50 text-amber-800')}>{counts.duplicate} duplicate</span>}
              {counts.invalid > 0 && <span className={chip('bg-rose-50 text-rose-700')}>{counts.invalid} invalid</span>}
            </div>
            <div className="max-h-72 overflow-auto border border-slate-200 rounded-lg">
              <table aria-label="Import preview" className="w-full min-w-[640px] text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 text-slate-600"><tr>{['#', 'Name', 'Phone', 'Type', 'Requestee', 'Qty', 'Status'].map(label => <th key={label} className="px-3 py-2 font-semibold whitespace-nowrap">{label}</th>)}</tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.slice(0, 200).map(row => <tr key={row.index} className={row.status === 'valid' ? '' : row.status === 'duplicate' ? 'bg-amber-50/50' : 'bg-rose-50/50'}>
                    <td className="px-3 py-2 text-slate-400">{row.index}</td><td className="px-3 py-2 font-medium text-slate-800">{row.name || '—'}</td><td className="px-3 py-2">{row.mobile || '—'}</td>
                    <td className="px-3 py-2">{row.type || '—'}</td><td className="px-3 py-2">{row.requestee || '—'}</td><td className="px-3 py-2">{row.allowedQuantity}</td>
                    <td className={`px-3 py-2 font-semibold whitespace-nowrap ${row.status === 'valid' ? 'text-emerald-700' : row.status === 'duplicate' ? 'text-amber-700' : 'text-rose-700'}`}>
                      {row.status === 'invalid' && <XCircle className="inline w-3.5 h-3.5 mr-1" aria-hidden="true" />}{row.reason}</td>
                  </tr>)}
                </tbody>
              </table>
            </div>
            {rows.length > 200 && <p className="text-xs text-slate-500">Showing the first 200 of {rows.length} rows. All rows are checked.</p>}
            <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
              <button type="button" disabled={importing} onClick={reset} className="px-3 py-2 border rounded-lg text-xs disabled:opacity-50">Choose another file</button>
              <button type="button" disabled={importing || !counts.valid} onClick={runImport} className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50">
                {importing ? 'Importing...' : `Import ${counts.valid} ${counts.valid === 1 ? 'row' : 'rows'}`}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};
