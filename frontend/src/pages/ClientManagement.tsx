import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Plus,
  Download,
  AlertCircle,
  CheckCircle2,
  Upload,
  AlertTriangle,
  FileText,
} from 'lucide-react';
import { api } from '../services/api';
import { BD, ClientRecord, VERTICAL_OPTIONS, VerticalType, ExcelRowPreview } from '../types';
import { SearchableSelect } from '../components/SearchableSelect';
import { Modal } from '../components/Modal';
import { useToast } from '../context/ToastContext';

const normalizeName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeMobile = (mobile: string) => {
  const digits = mobile.replace(/\D/g, '');
  return digits.length > 10 && digits.startsWith('91') ? digits.slice(-10) : digits;
};

interface ClientManagementProps {
  initialVertical?: string;
  initialBD?: string;
  onClientsChanged?: () => void;
  onBDsChanged?: () => void;
  onClose?: () => void;
}

export const ClientManagement: React.FC<ClientManagementProps> = ({ initialVertical = '', initialBD = '', onClientsChanged, onBDsChanged, onClose }) => {
  const { success, error, warning } = useToast();

  // State: Selections
  const [selectedVertical, setSelectedVertical] = useState<string>(initialVertical);
  const [selectedBD, setSelectedBD] = useState<string>(initialBD);
  const [bds, setBds] = useState<BD[]>([]);
  const [isLoadingBDs, setIsLoadingBDs] = useState<boolean>(false);

  // State: Add BD Modal
  const [isAddBDModalOpen, setIsAddBDModalOpen] = useState<boolean>(false);
  const [newBDName, setNewBDName] = useState<string>('');
  const [newBDEmail, setNewBDEmail] = useState<string>('');
  const [isSavingBD, setIsSavingBD] = useState<boolean>(false);
  const [bdFormError, setBdFormError] = useState<string>('');

  // Inline Excel preview stays bound to the selected Vertical and BD.
  const [isExcelOpen, setIsExcelOpen] = useState<boolean>(true);
  const [excelFile, setExcelFile] = useState<File | null>(null);
  const [parsedRows, setParsedRows] = useState<ExcelRowPreview[]>([]);
  const [isParsingExcel, setIsParsingExcel] = useState<boolean>(false);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [importSummary, setImportSummary] = useState<{
    totalReceived: number;
    successful: number;
    duplicates: number;
    invalid: number;
    skipped: number;
  } | null>(null);
  const scopeLocked = parsedRows.length > 0 || isParsingExcel || isImporting;
  const closeExcel = () => { setIsExcelOpen(false); onClose?.(); };

  // 1. Fetch BDs
  const fetchBDs = useCallback(async () => {
    setIsLoadingBDs(true);
    try {
      const res = await api.getBDs();
      if (res.success) {
        setBds(res.data);
      }
    } catch (err: any) {
      error(err.message || 'Failed to load Business Developers');
    } finally {
      setIsLoadingBDs(false);
    }
  }, [error]);

  useEffect(() => {
    fetchBDs();
  }, [fetchBDs]);

  // Active BD Object
  const currentBDObject = useMemo(() => {
    return bds.find((b) => b._id === selectedBD);
  }, [bds, selectedBD]);

  // Dropdown options
  const verticalOptions = useMemo(() => {
    return VERTICAL_OPTIONS.map((v) => ({ label: v, value: v }));
  }, []);

  const bdOptions = useMemo(() => {
    return bds.map((b) => ({
      label: b.name,
      value: b._id,
      subtext: b.email,
    }));
  }, [bds]);

  // Save New BD
  const handleSaveBD = async (e: React.FormEvent) => {
    e.preventDefault();
    setBdFormError('');

    if (!newBDName.trim()) {
      setBdFormError('Business Developer name is required.');
      return;
    }
    if (!newBDEmail.trim() || !/^\S+@\S+\.\S+$/.test(newBDEmail.trim())) {
      setBdFormError('A valid email address is required.');
      return;
    }

    setIsSavingBD(true);
    try {
      const res = await api.createBD(newBDName.trim(), newBDEmail.trim());
      if (res.success && res.data) {
        success(`BD "${res.data.name}" registered successfully.`);
        await fetchBDs();
        onBDsChanged?.();
        setSelectedBD(res.data._id);
        setIsAddBDModalOpen(false);
        setNewBDName('');
        setNewBDEmail('');
      }
    } catch (err: any) {
      setBdFormError(err.message || 'Failed to create BD. Check for duplicates.');
    } finally {
      setIsSavingBD(false);
    }
  };

  // Download Sample Template
  const handleDownloadSample = () => {
    try {
      const sampleRows = [
        {
          'Client/Vendor Name': 'Acme Global Media Ltd',
          'Mobile Number': '9876543210',
          'Email ID': 'contact@acmeglobal.com',
        },
        {
          'Client/Vendor Name': 'Apex Billboard Enterprises',
          'Mobile Number': '9812345678',
          'Email ID': 'sales@apexenterprise.com',
        },
        {
          'Client/Vendor Name': 'Metro Arts & Prints',
          'Mobile Number': '9840123987',
          'Email ID': 'info@metroarts.in',
        },
      ];

      const ws = XLSX.utils.json_to_sheet(sampleRows);
      ws['!cols'] = [{ wch: 30 }, { wch: 18 }, { wch: 28 }];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Sample_Clients');
      XLSX.writeFile(wb, 'Diwali_Sweet_Distribution_Client_Template.xlsx');
      success('Sample Excel template downloaded.');
    } catch (err) {
      window.open(api.getSampleTemplateUrl(), '_blank');
    }
  };

  // Handle Excel Upload & Preview
  const handleExcelFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.match(/\.(xlsx|xls|csv)$/i)) {
      error('Please select a valid Excel file (.xlsx, .xls) or CSV file.');
      return;
    }

    setExcelFile(file);
    setParsedRows([]);
    setIsParsingExcel(true);
    setImportSummary(null);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const data = evt.target?.result;
        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

        if (!rows || rows.length === 0) {
          warning('The uploaded sheet is empty.');
          setParsedRows([]);
          setIsParsingExcel(false);
          return;
        }

        // Preview checks every association in this scope, not only the visible page.
        const allClients: ClientRecord[] = [];
        let page = 1, pages = 1;
        do {
          const result = await api.getClients(selectedVertical as VerticalType, selectedBD, '', page, 100);
          allClients.push(...result.data);
          pages = result.pagination.totalPages;
          page++;
        } while (page <= pages);
        const existingMobiles = new Set(allClients.map(c => normalizeMobile(c.mobile)));
        const existingNames = new Set(allClients.map(c => normalizeName(c.name)));
        const seenMobiles = new Set<string>();
        const seenNames = new Set<string>();

        const previews: ExcelRowPreview[] = rows.map((row, idx) => {
          const rawName = row['Client/Vendor Name'] || row['Client Name'] || row['Name'] || row['Vendor Name'] || '';
          const rawMobile = row['Mobile Number'] || row['Mobile'] || row['Phone'] || row['Contact'] || '';
          const rawEmail = row['Email ID'] || row['Email'] || row['Email Address'] || '';

          const name = String(rawName).trim();
          const mobile = String(rawMobile).trim();
          const email = String(rawEmail).trim().toLowerCase();

          let isValid = true;
          let isDuplicate = false;
          let statusText = 'Valid';

          if (!name) {
            isValid = false;
            statusText = 'Missing Name';
          } else if (mobile.replace(/\D/g, '').length < 7 || mobile.replace(/\D/g, '').length > 15 || !/^[+\d\s().-]+$/.test(mobile)) {
            isValid = false;
            statusText = 'Invalid Phone Number';
          } else if (email && !/^\S+@\S+\.\S+$/.test(email)) {
            isValid = false;
            statusText = 'Invalid Email';
          } else {
            const cleanDigits = normalizeMobile(mobile);
            const cleanName = normalizeName(name);
            if (seenMobiles.has(cleanDigits) || seenNames.has(cleanName)) {
              isDuplicate = true;
              statusText = 'Duplicate in File';
            } else if (existingMobiles.has(cleanDigits) || existingNames.has(cleanName)) {
              isDuplicate = true;
              statusText = 'Already Registered Here';
            }
            seenMobiles.add(cleanDigits);
            seenNames.add(cleanName);
          }

          return {
            index: idx + 1,
            name,
            mobile,
            email,
            isValid: isValid && !isDuplicate,
            isDuplicate,
            statusText,
          };
        });

        setParsedRows(previews);
      } catch (err: any) {
        error('Failed to parse Excel file.');
      } finally {
        setIsParsingExcel(false);
      }
    };

    reader.onerror = () => { setIsParsingExcel(false); error('Failed to read Excel file.'); };
    reader.readAsBinaryString(file);
    e.target.value = '';
  };

  // Confirm Excel Bulk Import
  const handleConfirmImport = async () => {
    const validRecords = parsedRows
      .filter((r) => r.isValid)
      .map((r) => ({
        name: r.name,
        mobile: r.mobile,
        email: r.email,
      }));

    if (validRecords.length === 0) {
      warning('No valid records found to import.');
      return;
    }

    setIsImporting(true);
    try {
      const res = await api.bulkImportClients(
        selectedVertical as VerticalType,
        selectedBD,
        validRecords
      );

      if (res.success) {
        const previewDuplicates = parsedRows.filter(row => row.isDuplicate).length;
        const previewInvalid = parsedRows.filter(row => !row.isValid && !row.isDuplicate).length;
        setImportSummary({ ...res.summary, totalReceived: parsedRows.length,
          duplicates: res.summary.duplicates + previewDuplicates, invalid: res.summary.invalid + previewInvalid,
          skipped: res.summary.skipped + previewDuplicates + previewInvalid });
        success(`Successfully imported ${res.summary.successful} client/vendor registrations.`);
        onClientsChanged?.();
      }
    } catch (err: any) {
      error(err.message || 'Import failed.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Excel Import &amp; Business Developers</h2>
          <p className="text-xs text-slate-500 mt-1">Choose the association for imported clients. Importing does not record sweet distributions.</p>
        </div>
        <button type="button" onClick={handleDownloadSample} className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-amber-700">
          <Download className="w-3.5 h-3.5" /> Excel Template
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] items-end gap-3">
          <div className="min-w-0">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Vertical</label>
            <SearchableSelect options={verticalOptions} value={selectedVertical} onChange={val => { setSelectedVertical(val); }} placeholder="Select Vertical..." disabled={scopeLocked} />
          </div>
          <div className="min-w-0">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Business Developer (BD)</label>
            <SearchableSelect options={bdOptions} value={selectedBD} onChange={val => { setSelectedBD(val); }} placeholder={isLoadingBDs ? 'Loading BDs...' : 'Select Business Developer...'} disabled={scopeLocked} />
          </div>
          <button type="button" disabled={scopeLocked} onClick={() => { setNewBDName(''); setNewBDEmail(''); setBdFormError(''); setIsAddBDModalOpen(true); }} className="inline-flex justify-center items-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
            <Plus className="w-4 h-4" /> Add BD
          </button>
        </div>
        {scopeLocked && <p className="mt-2 text-xs text-slate-500">Clear the preview before changing the import Vertical or BD.</p>}
      </div>

      {isExcelOpen && <section aria-label="Excel import preview" className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold text-sm text-slate-800">Import Clients / Vendors from Excel{excelFile ? ` - ${excelFile.name}` : ''}</h3>
          <button type="button" disabled={isParsingExcel || isImporting} onClick={closeExcel} className="text-xs font-semibold text-slate-500 hover:text-slate-800 disabled:opacity-50">Close preview</button>
        </div>
        <div className="space-y-5">
          {!parsedRows.length && !importSummary && (
            <div className="space-y-4">
              <div className="border-2 border-dashed border-slate-300 hover:border-amber-500 rounded-xl p-8 text-center bg-slate-50/50 hover:bg-amber-50/20 transition-all">
                <Upload className="w-10 h-10 text-amber-600 mx-auto mb-3" />
                <h4 className="text-sm font-bold text-slate-800">
                  Select or drag an Excel file (.xlsx, .xls)
                </h4>
                <p className="text-xs text-slate-500 mt-1 mb-4">
                  Columns expected: <code>Client/Vendor Name</code> (req), <code>Mobile Number</code> (req), <code>Email ID</code>
                </p>

                <label className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold rounded-lg cursor-pointer shadow-sm transition-colors">
                  <span>Browse File</span>
                  <input
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    disabled={isParsingExcel || isImporting || !selectedVertical || !selectedBD}
                    className="hidden"
                    onChange={handleExcelFileChange}
                  />
                </label>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-slate-100/70 rounded-lg border border-slate-200 text-xs">
                <div className="flex items-center gap-2 text-slate-600">
                  <FileText className="w-4 h-4 text-slate-500" />
                  <span>Need the standard template format?</span>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadSample}
                  className="font-semibold text-amber-700 hover:text-amber-800 hover:underline flex items-center gap-1"
                >
                  <Download className="w-3.5 h-3.5" />
                  Download Sample Template
                </button>
              </div>
            </div>
          )}

          {isParsingExcel && (
            <div className="py-10 text-center">
              <div className="w-7 h-7 border-3 border-amber-600 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs font-medium text-slate-600">Parsing and validating Excel rows...</p>
            </div>
          )}

          {parsedRows.length > 0 && !importSummary && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="p-3 bg-slate-100 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block">Total In Sheet</span>
                  <span className="text-base font-bold text-slate-800">{parsedRows.length}</span>
                </div>
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                  <span className="text-emerald-700 block">Ready to Import</span>
                  <span className="text-base font-bold text-emerald-800">
                    {parsedRows.filter((r) => r.isValid).length}
                  </span>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <span className="text-amber-700 block">Duplicates (Skipped)</span>
                  <span className="text-base font-bold text-amber-800">
                    {parsedRows.filter((r) => r.isDuplicate).length}
                  </span>
                </div>
                <div className="p-3 bg-rose-50 rounded-lg border border-rose-200">
                  <span className="text-rose-700 block">Invalid (Skipped)</span>
                  <span className="text-base font-bold text-rose-800">
                    {parsedRows.filter((r) => !r.isValid && !r.isDuplicate).length}
                  </span>
                </div>
              </div>

              <div className="border border-slate-200 rounded-lg overflow-hidden max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-100 sticky top-0 text-slate-600 font-semibold border-b border-slate-200">
                    <tr>
                      <th className="p-2.5 w-12 text-center">#</th>
                      <th className="p-2.5">Name</th>
                      <th className="p-2.5">Mobile</th>
                      <th className="p-2.5">Email</th>
                      <th className="p-2.5 w-36">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {parsedRows.map((row) => (
                      <tr
                        key={row.index}
                        className={`transition-colors ${
                          row.isValid
                            ? 'hover:bg-slate-50'
                            : row.isDuplicate
                            ? 'bg-amber-50/50'
                            : 'bg-rose-50/50'
                        }`}
                      >
                        <td className="p-2.5 text-center text-slate-400 font-mono">{row.index}</td>
                        <td className="p-2.5 font-medium text-slate-800">
                          {row.name || <span className="text-rose-500 italic">Missing Name</span>}
                        </td>
                        <td className="p-2.5 font-mono text-slate-600">
                          {row.mobile || <span className="text-rose-500 italic">Missing Mobile</span>}
                        </td>
                        <td className="p-2.5 text-slate-600">{row.email || '—'}</td>
                        <td className="p-2.5">
                          {row.isValid ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                              <CheckCircle2 className="w-3 h-3" /> Valid
                            </span>
                          ) : row.isDuplicate ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800">
                              <AlertTriangle className="w-3 h-3" /> {row.statusText}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-rose-100 text-rose-800">
                              <AlertCircle className="w-3 h-3" /> {row.statusText}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isImporting || isParsingExcel}
                  onClick={() => {
                    setParsedRows([]);
                    setExcelFile(null);
                  }}
                  className="px-3.5 py-1.5 text-xs text-slate-600 hover:text-slate-800 border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Choose Different File
                </button>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isImporting || isParsingExcel} onClick={closeExcel}
                    className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isImporting || parsedRows.filter((r) => r.isValid).length === 0}
                    onClick={handleConfirmImport}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-sm disabled:opacity-50"
                  >
                    {isImporting
                      ? 'Importing...'
                      : `Confirm & Import ${parsedRows.filter((r) => r.isValid).length} Records`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {importSummary && (
            <div className="space-y-4 py-2">
              <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                <CheckCircle2 className="w-10 h-10 text-emerald-600 mx-auto mb-2" />
                <h4 className="text-base font-bold text-emerald-900">
                  Import Completed!
                </h4>
                <p className="text-xs text-emerald-700 mt-1">
                  The valid client/vendor contacts have been registered under Vertical{' '}
                  <strong>{selectedVertical}</strong> and BD <strong>{currentBDObject?.name}</strong>.
                </p>
              </div>

              <div className="grid grid-cols-4 gap-3 text-xs text-center">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <span className="text-slate-500 block">Total Read</span>
                  <span className="text-lg font-bold text-slate-800">{importSummary.totalReceived}</span>
                </div>
                <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                  <span className="text-emerald-700 block">Imported</span>
                  <span className="text-lg font-bold text-emerald-800">{importSummary.successful}</span>
                </div>
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                  <span className="text-amber-700 block">Duplicates</span>
                  <span className="text-lg font-bold text-amber-800">{importSummary.duplicates}</span>
                </div>
                <div className="p-3 bg-rose-50 rounded-lg border border-rose-200">
                  <span className="text-rose-700 block">Invalid</span>
                  <span className="text-lg font-bold text-rose-800">{importSummary.invalid}</span>
                </div>
              </div>

              <div className="flex justify-end pt-3 border-t border-slate-100">
                <button
                  type="button"
                  disabled={isImporting || isParsingExcel} onClick={closeExcel}
                  className="px-5 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg shadow-sm"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </section>}

      {/* MODAL 1: Add New BD */}
      <Modal
        isOpen={isAddBDModalOpen}
        onClose={() => setIsAddBDModalOpen(false)}
        title="Add Business Developer (BD)"
        subtitle="Register a new Business Developer into the system"
      >
        <form onSubmit={handleSaveBD} className="space-y-4">
          {bdFormError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 font-medium">
              {bdFormError}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              BD Name <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={newBDName}
              onChange={(e) => setNewBDName(e.target.value)}
              placeholder="e.g. Ramesh Krishnan"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 text-slate-800"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Email ID <span className="text-rose-500">*</span>
            </label>
            <input
              type="email"
              required
              value={newBDEmail}
              onChange={(e) => setNewBDEmail(e.target.value)}
              placeholder="e.g. ramesh.k@adinn.com"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 text-slate-800"
            />
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-4 border-t border-slate-100">
            <button
              type="button"
              onClick={() => setIsAddBDModalOpen(false)}
              className="px-4 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSavingBD}
              className="px-4 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg disabled:opacity-50"
            >
              {isSavingBD ? 'Saving BD...' : 'Save BD'}
            </button>
          </div>
        </form>
      </Modal>

    </div>
  );
};
