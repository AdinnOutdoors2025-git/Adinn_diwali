import * as XLSX from 'xlsx';
import { BD, DistributionRow, TYPE_OPTIONS } from '../types';
import { MODE_LABEL, MODE_OPTIONS, STATUS_FLOW, STATUS_LABEL } from '../config/distribution';
import { bucketOf, quantityOf, quantityTotals } from './distributionStats';

export interface EntryExportFilters {
  year: number; occasion?: string; type: string; bd: string; status: 'ALL' | 'GIVEN' | 'NOT_GIVEN'; mode: string; deliveryStatus: string; search: string;
}
const theme = { navy: '14213D', orange: 'F59E0B', gold: 'FCD34D', ivory: 'FFFBEB', white: 'FFFFFF', green: '059669', rose: 'E11D48', slate: '64748B' };
const ns = { sheet: 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', rel: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  package: 'http://schemas.openxmlformats.org/package/2006/relationships', chart: 'http://schemas.openxmlformats.org/drawingml/2006/chart', drawing: 'http://schemas.openxmlformats.org/drawingml/2006/main' };
const declaration = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const xml = (value: unknown) => String(value ?? '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
type Value = string | number | null;
type Cell = Value | { value: Value; style: number };
type Matrix = Cell[][];
const col = (index: number) => {
  let result = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) result = String.fromCharCode(65 + (value - 1) % 26) + result;
  return result;
};
const dateText = (value?: string | null) => value ? new Date(value).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : '';

function styles() {
  const fonts = [
    `<font><sz val="13"/><color rgb="FF${theme.navy}"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="22"/><color rgb="FF${theme.white}"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="13"/><color rgb="FF${theme.white}"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="12"/><color rgb="FF${theme.slate}"/><name val="Calibri"/></font>`,
    ...[theme.green, theme.rose].map(color => `<font><b/><sz val="13"/><color rgb="FF${color}"/><name val="Calibri"/></font>`),
    ...[theme.navy, theme.green, theme.rose].map(color => `<font><b/><sz val="26"/><color rgb="FF${color}"/><name val="Calibri"/></font>`),
    `<font><sz val="12"/><color rgb="FF${theme.slate}"/><name val="Calibri"/></font>`,
    `<font><b/><sz val="13"/><color rgb="FF${theme.navy}"/><name val="Calibri"/></font>`,
  ];
  const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
    ...[theme.navy, theme.ivory, theme.white, theme.gold].map(color => `<fill><patternFill patternType="solid"><fgColor rgb="FF${color}"/><bgColor indexed="64"/></patternFill></fill>`)];
  const xf = (font: number, fill: number, border = 1, format = 0, alignment = 'left') => `<xf numFmtId="${format}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0" applyFont="1" applyFill="1" applyBorder="1"${format ? ' applyNumberFormat="1"' : ''}><alignment horizontal="${alignment}" vertical="center" wrapText="1"/></xf>`;
  const formats = [xf(0, 4, 0), xf(1, 2, 0), xf(3, 4, 0), xf(2, 2, 2), xf(0, 4), xf(0, 3),
    xf(4, 4, 1, 0, 'center'), xf(4, 3, 1, 0, 'center'), xf(5, 4, 1, 0, 'center'), xf(5, 3, 1, 0, 'center'),
    xf(0, 4, 1, 166, 'center'), xf(0, 3, 1, 166, 'center'), xf(0, 4, 1, 164, 'center'), xf(0, 3, 1, 164, 'center'),
    xf(0, 4, 1, 165, 'center'), xf(0, 3, 1, 165, 'center'), xf(2, 2, 2), xf(10, 3, 2, 0, 'center'),
    xf(6, 3, 2, 166, 'center'), xf(7, 3, 2, 166, 'center'), xf(8, 3, 2, 166, 'center'), xf(6, 5, 2, 164, 'center'),
    xf(9, 4, 0), xf(3, 5, 0), xf(0, 4, 1, 0, 'center'), xf(0, 3, 1, 0, 'center')];
  return declaration + `<styleSheet xmlns="${ns.sheet}"><numFmts count="3"><numFmt numFmtId="164" formatCode="0.00%"/><numFmt numFmtId="165" formatCode="dd mmm yyyy hh:mm:ss"/><numFmt numFmtId="166" formatCode="#,##0"/></numFmts><fonts count="${fonts.length}">${fonts.join('')}</fonts><fills count="${fills.length}">${fills.join('')}</fills><borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border><border>${['left', 'right', 'top', 'bottom'].map(side => `<${side} style="hair"><color rgb="FFE2E8F0"/></${side}>`).join('')}<diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FF${theme.orange}"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${formats.length}">${formats.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
}

interface SheetOptions { widths: number[]; frozen?: number; filter?: boolean; merges?: string[]; heights?: Record<number, number>; drawing?: boolean; minRows?: number; defaultHeight?: number; pageBreak?: number }
function worksheet(rows: Matrix, options: SheetOptions) {
  const lastRow = Math.max(rows.length, options.minRows || 1), lastCol = col(options.widths.length - 1), frozen = options.frozen ?? 1;
  const body = Array.from({ length: lastRow }, (_, index) => `<row r="${index + 1}" ht="${options.heights?.[index + 1] || (index === 0 ? 34 : options.defaultHeight || 32)}" customHeight="1">${(rows[index] || []).map((cell, column) => {
    const object = cell !== null && typeof cell === 'object' ? cell : { value: cell, style: index === 0 ? 3 : index % 2 ? 4 : 5 };
    const address = `${col(column)}${index + 1}`, value = object.value;
    return typeof value === 'number' ? `<c r="${address}" s="${object.style}"><v>${value}</v></c>`
      : `<c r="${address}" s="${object.style}" t="inlineStr"><is><t xml:space="preserve">${xml(value ?? '')}</t></is></c>`;
  }).join('')}</row>`).join('');
  return declaration + `<worksheet xmlns="${ns.sheet}" xmlns:r="${ns.rel}"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:${lastCol}${lastRow}"/><sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${frozen}" topLeftCell="A${frozen + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="${options.defaultHeight || 32}"/><cols>${options.widths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join('')}</cols><sheetData>${body}</sheetData>${options.filter ? `<autoFilter ref="A1:${lastCol}${rows.length}"/>` : ''}${options.merges?.length ? `<mergeCells count="${options.merges.length}">${options.merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : ''}<printOptions horizontalCentered="1"/><pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.2" footer="0.2"/><pageSetup paperSize="8" orientation="landscape" fitToWidth="1" fitToHeight="0"/>${options.pageBreak ? `<rowBreaks count="1" manualBreakCount="1"><brk id="${options.pageBreak}" min="0" max="16383" man="1"/></rowBreaks>` : ''}${options.drawing ? '<drawing r:id="rIdDrawing"/>' : ''}</worksheet>`;
}

interface Series { name: string; formula: string; values: number[]; color: string }
function chart(title: string, categories: string[], formula: string, series: Series[], kind: 'donut' | 'vertical' | 'bd') {
  const font = (size = 1200) => `<c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="${size}"><a:solidFill><a:srgbClr val="${theme.navy}"/></a:solidFill><a:latin typeface="Calibri"/></a:defRPr></a:pPr><a:endParaRPr lang="en-US"/></a:p></c:txPr>`;
  const seriesXML = series.map((entry, index) => `<c:ser><c:idx val="${index}"/><c:order val="${index}"/><c:tx><c:v>${xml(entry.name)}</c:v></c:tx><c:spPr><a:solidFill><a:srgbClr val="${entry.color}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>${kind !== 'vertical' ? categories.map((_, point) => `<c:dPt><c:idx val="${point}"/><c:spPr><a:solidFill><a:srgbClr val="${(kind === 'donut' ? [theme.green, theme.orange, theme.rose] : [theme.navy, theme.gold, theme.orange])[point % 3]}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr></c:dPt>`).join('') : ''}<c:cat><c:strRef><c:f>${xml(formula)}</c:f><c:strCache><c:ptCount val="${categories.length}"/>${categories.map((value, point) => `<c:pt idx="${point}"><c:v>${xml(value)}</c:v></c:pt>`).join('')}</c:strCache></c:strRef></c:cat><c:val><c:numRef><c:f>${xml(entry.formula)}</c:f><c:numCache><c:formatCode>#,##0</c:formatCode><c:ptCount val="${entry.values.length}"/>${entry.values.map((value, point) => `<c:pt idx="${point}"><c:v>${value}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val></c:ser>`).join('');
  const labels = `<c:dLbls><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="${kind === 'donut' ? 1 : 0}"/></c:dLbls>`;
  const largest = Math.max(1, ...series.flatMap(row => row.values));
  const body = kind === 'donut' ? `<c:doughnutChart><c:varyColors val="1"/>${seriesXML}${labels}<c:firstSliceAng val="270"/><c:holeSize val="65"/></c:doughnutChart>`
    : `<c:barChart><c:barDir val="${kind === 'bd' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="${kind === 'bd' ? 1 : 0}"/>${seriesXML}${kind === 'bd' ? labels : ''}<c:gapWidth val="80"/><c:axId val="100"/><c:axId val="200"/></c:barChart><c:catAx><c:axId val="100"/><c:scaling><c:orientation val="${kind === 'bd' ? 'maxMin' : 'minMax'}"/></c:scaling><c:delete val="0"/><c:axPos val="${kind === 'bd' ? 'l' : 'b'}"/><c:tickLblPos val="nextTo"/>${font(1100)}<c:crossAx val="200"/><c:crosses val="autoZero"/></c:catAx><c:valAx><c:axId val="200"/><c:scaling><c:orientation val="minMax"/><c:min val="0"/></c:scaling><c:delete val="0"/><c:axPos val="${kind === 'bd' ? 'b' : 'l'}"/><c:majorGridlines><c:spPr><a:ln w="6350"><a:solidFill><a:srgbClr val="E2E8F0"/></a:solidFill></a:ln></c:spPr></c:majorGridlines><c:numFmt formatCode="#,##0" sourceLinked="0"/><c:tickLblPos val="nextTo"/>${font(1100)}<c:crossAx val="100"/><c:crosses val="autoZero"/><c:crossBetween val="between"/><c:majorUnit val="${Math.max(1, Math.ceil(largest / 5))}"/></c:valAx>`;
  return declaration + `<c:chartSpace xmlns:c="${ns.chart}" xmlns:a="${ns.drawing}" xmlns:r="${ns.rel}"><c:lang val="en-US"/><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1600" b="1"><a:solidFill><a:srgbClr val="${theme.navy}"/></a:solidFill></a:rPr><a:t>${xml(title)}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/>${body}<c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:plotArea><c:legend><c:legendPos val="b"/><c:layout/><c:overlay val="0"/>${font()}</c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="zero"/></c:chart><c:spPr><a:noFill/><a:ln><a:noFill/></a:ln></c:spPr></c:chartSpace>`;
}

export function buildEntryWorkbook(records: DistributionRow[], bds: BD[], filters: EntryExportFilters): Blob {
  const rows = [...new Map(records.map(row => [row.clientId, row])).values()];
  // Given = Delivered quantity, In Progress = saved but not Delivered, Pending = Total - Given - In Progress.
  const totals = quantityTotals(rows);
  const given = totals.given.clients, inProgress = totals.inProgress.clients, pending = totals.pending.clients;
  const givenQty = totals.given.quantity, inProgressQty = totals.inProgress.quantity, totalQty = totals.total, pendingQty = totalQty - givenQty - inProgressQty;
  const group = (clients: DistributionRow[]) => {
    const t = quantityTotals(clients);
    return { registered: clients.length, given: t.given.clients, inProgress: t.inProgress.clients, pending: t.pending.clients, percent: t.completion };
  };
  const delivered = (row: DistributionRow) => bucketOf(row) === 'GIVEN';
  const selectedBD = bds.find(row => row._id === filters.bd);
  if (filters.bd !== 'ALL' && !selectedBD) throw new Error('Selected BD is no longer in the master list');
  const types = TYPE_OPTIONS.map(type => {
    const clients = rows.filter(row => row.associations.some(link => link.type === type));
    return { name: type, ...group(clients), credited: rows.filter(row => delivered(row) && row.currentYearDistribution?.type === type).length };
  });
  const bdGroups = bds.map(bd => {
    const clients = rows.filter(row => row.associations.some(link => link.bd?._id === bd._id));
    return { ...bd, ...group(clients), credited: rows.filter(row => delivered(row) && row.currentYearDistribution?.bdId === bd._id).length };
  });
  const chartBDs = bdGroups.filter(row => row.registered || row.credited).sort((a, b) => b.credited - a.credited || a.name.localeCompare(b.name));
  const chartRows = chartBDs.length ? chartBDs : [{ name: '', email: '', registered: 0, given: 0, inProgress: 0, pending: 0, percent: 0, credited: 0 }];
  const summary: Matrix = [];
  const put = (row: number, column: number, value: Value, style = 0) => { summary[row - 1] ||= []; summary[row - 1][column - 1] = { value, style }; };
  const merges = ['A1:L2', 'E3:L3', 'B4:C4', 'E4:L4', 'B5:C5', 'E5:L5', 'B6:C6', 'E6:L6', 'A12:L12', 'A13:L13', 'A14:L14', 'A15:L15'];
  const occasionName = filters.occasion || 'Diwali';
  put(1, 1, `ADINN | ${occasionName} Sweet Distribution Report`, 1);
  put(3, 1, `${occasionName} year`, 2); put(3, 2, filters.year, 24); put(3, 4, 'Generated (IST)', 2); put(3, 5, dateText(new Date().toISOString()), 22);
  put(4, 1, 'Type', 2); put(4, 2, filters.type === 'ALL' ? 'All Types' : filters.type);
  put(4, 4, 'Requestee Name', 2); put(4, 5, selectedBD ? `${selectedBD.name} (${selectedBD.email})` : 'All Requestees');
  put(5, 1, 'Search', 2); put(5, 2, filters.search || 'All clients');
  put(5, 4, 'Mode / Stage', 2);
  put(5, 5, filters.mode === 'ALL' ? 'All Modes' : `${MODE_LABEL[filters.mode as keyof typeof MODE_LABEL] ?? filters.mode}${filters.deliveryStatus === 'ALL' ? ' - all stages' : ` - ${STATUS_LABEL[filters.deliveryStatus as keyof typeof STATUS_LABEL] ?? filters.deliveryStatus}`}`);
  put(6, 1, 'Status', 2); put(6, 2, filters.status === 'ALL' ? 'All' : filters.status === 'GIVEN' ? 'Given' : 'Not Given');
  put(6, 4, 'Scope', 2); put(6, 5, `${rows.length} distinct matching clients`);
  const kpis = [
    { start: 0, end: 1, title: 'Registered clients', value: rows.length, style: 18 },
    { start: 2, end: 3, title: 'Total Quantity', value: totalQty, style: 18 },
    { start: 4, end: 5, title: 'Given Quantity', value: givenQty, style: 19 },
    { start: 6, end: 7, title: 'In Progress Quantity', value: inProgressQty, style: 18 },
    { start: 8, end: 9, title: 'Pending Quantity', value: pendingQty, style: 20 },
    { start: 10, end: 11, title: 'Completion', value: totals.completion, style: 21 },
  ];
  for (const kpi of kpis) { put(8, kpi.start + 1, kpi.title, 17); put(9, kpi.start + 1, kpi.value, kpi.style); merges.push(`${col(kpi.start)}8:${col(kpi.end)}8`, `${col(kpi.start)}9:${col(kpi.end)}10`); }
  put(12, 1, 'REPORTING BASIS', 16);
  put(13, 1, 'A client is counted once overall. Given means an active distribution has reached Delivered (older untracked records count as Given); In Progress means saved but not yet Delivered; Not Given means nothing is saved. Quantities follow the same rule.', 22);
  put(14, 1, 'Type/Requestee groups may overlap. Group Given and completion rates use global client status; completed distributions are credited once to the recorded Type/Requestee.', 22);
  put(15, 1, 'Times are shown in IST. Distribution Marked is when sweets were recorded, not the client creation date.', 22);
  const headers = (row: number, values: string[]) => values.forEach((value, index) => put(row, index + 1, value, 3));
  const rowHeights: Record<number, number> = {};
  let r = 17;
  headers(r, ['Distribution Status', 'Clients', 'Quantity']); rowHeights[r] = 30;
  const overall: [string, number, number, number][] = [['Given', 6, given, givenQty], ['In Progress', 24, inProgress, inProgressQty], ['Not Given', 8, pending, pendingQty]];
  const overallStart = r + 1;
  overall.forEach(([label, style, clients, qty]) => { r++; put(r, 1, label, style); put(r, 2, clients, 10); put(r, 3, qty, 10); });
  // Per delivery mode, from the modes/stages actually present in the data plus the ones the application supports.
  const modeKeys = [...new Set<string>([...MODE_OPTIONS, ...rows.map(row => row.currentYearDistribution?.mode).filter((mode): mode is NonNullable<typeof mode> => !!mode)])];
  const inMode = (mode: string | null) => rows.filter(row => !row.isEligible && (row.currentYearDistribution?.mode ?? null) === mode);
  const line = (label: string, list: DistributionRow[], labelStyle = 4) => {
    r++; put(r, 1, label, labelStyle); put(r, 2, list.length, 10); put(r, 3, list.reduce((sum, row) => sum + quantityOf(row), 0), 10);
  };
  const banner = (label: string) => { r++; put(r, 1, label, 16); put(r, 2, null, 16); put(r, 3, null, 16); };
  r += 2; headers(r, ['Distribution Status by Mode', 'Clients', 'Quantity']); rowHeights[r] = 30;
  for (const mode of modeKeys) {
    const list = inMode(mode);
    const stages = [...new Set<string>([...(STATUS_FLOW[mode as keyof typeof STATUS_FLOW] ?? []), ...list.map(row => row.currentYearDistribution?.status ?? '').filter(Boolean)])];
    banner((MODE_LABEL[mode as keyof typeof MODE_LABEL] ?? mode).toUpperCase());
    line('In Progress (not yet Delivered)', list.filter(row => bucketOf(row) === 'IN_PROGRESS'), 24);
    stages.forEach(stage => {
      const label = STATUS_LABEL[stage as keyof typeof STATUS_LABEL] ?? stage;
      line(stage === 'DELIVERED' ? 'Delivered / Given' : '   ' + label, list.filter(row => row.currentYearDistribution?.status === stage), stage === 'DELIVERED' ? 6 : 4);
    });
  }
  const legacy = inMode(null);
  if (legacy.length) { banner('LEGACY (NO MODE)'); line('Given (recorded before tracking)', legacy, 6); }
  banner('NOT GIVEN');
  line('Not Given (no distribution saved)', rows.filter(row => bucketOf(row) === 'NOT_GIVEN'), 8);
  const typeHeader = r + 2, typeStart = typeHeader + 1;
  headers(typeHeader, ['Type', 'Eligible clients', 'Given', 'In Progress', 'Not Given', 'Completion', 'Completed here']); rowHeights[typeHeader] = 32;
  types.forEach((row, index) => [row.name, row.registered, row.given, row.inProgress, row.pending, row.percent, row.credited].forEach((value, column) => put(typeStart + index, column + 1, value, column === 5 ? 12 : column ? 10 : 4)));
  const bdHeader = typeHeader + types.length + 2;
  headers(bdHeader, ['Requestee Name', 'Requestee Email', 'Associated clients', 'Given', 'In Progress', 'Not Given', 'Completed by Requestee']); rowHeights[bdHeader] = 32;
  chartRows.forEach((row, index) => [row.name, row.email, row.registered, row.given, row.inProgress, row.pending, row.credited].forEach((value, column) => put(bdHeader + 1 + index, column + 1, value, column >= 2 ? 10 : 4)));
  const chartTop = Math.max(40, bdHeader + chartRows.length + 3), chartBottom = chartTop + 19;

  const headings = ['S.No.', 'Client/Vendor Name', 'Phone Number', 'Email', 'Type', 'Requestee Name', 'Requestee Email', 'Created At (IST)', 'Distribution Year', 'Distribution Quantity', 'Mode', 'Status', 'Distribution Status', 'Distribution Marked', 'Last Given Year'];
  const details: Matrix = [headings];
  const detailHeights: Record<number, number> = { 1: 36 };
  const STATUS_COL = 12, DATE_COLS = [7, 13], NUMBER_COLS = [0, 8, 9, 14];
  rows.forEach((row, index) => {
    const given = row.currentYearDistribution;
    const values: Value[] = [index + 1, row.clientName, row.clientMobile, row.clientEmail || '', row.associations.map(link => link.type ?? 'Unassigned').join('\n'),
      row.associations.map(link => link.bd?.name || '').join('\n'), row.associations.map(link => link.bd?.email || '').join('\n'), dateText(row.createdAt), filters.year,
      given?.quantity ?? '', given?.mode ? MODE_LABEL[given.mode] : '', given?.status ? STATUS_LABEL[given.status] : '',
      ({ GIVEN: 'Given', IN_PROGRESS: 'In Progress', NOT_GIVEN: 'Not Given' })[bucketOf(row)], dateText(given?.distributedAt), row.lastGiven ?? ''];
    details.push(values.map((value, column) => ({ value, style: column === STATUS_COL ? (bucketOf(row) === 'NOT_GIVEN' ? 8 : bucketOf(row) === 'GIVEN' ? 6 : 24) + index % 2 : DATE_COLS.includes(column) ? 14 + index % 2 : NUMBER_COLS.includes(column) ? 24 + index % 2 : 4 + index % 2 })));
    detailHeights[index + 2] = Math.max(34, row.associations.length * 18 + 14);
  });
  const table = (header: string[], data: Value[][], percentCol: number): Matrix => [header, ...data.map((row, index) => row.map((value, column) => ({ value, style: column === percentCol ? 12 + index % 2 : typeof value === 'number' ? 10 + index % 2 : 4 + index % 2 })))];
  const typeTable = table(['Type', 'Eligible clients/vendors', 'Given', 'In Progress', 'Not Given', 'Completion percentage', 'Completed here'], types.map(row => [row.name, row.registered, row.given, row.inProgress, row.pending, row.percent, row.credited]), 5);
  const bdTable = table(['Requestee Name', 'Requestee Email', 'Associated clients/vendors', 'Given (any Requestee)', 'In Progress', 'Not Given', 'Distributions completed', 'Completion percentage'], bdGroups.map(row => [row.name, row.email, row.registered, row.given, row.inProgress, row.pending, row.credited, row.percent]), 7);
  const parts: Record<string, string> = {
    'xl/styles.xml': styles(),
    'xl/worksheets/sheet1.xml': worksheet(summary, { widths: [28, 30, 16, 18, 20, 20, 16, 16, 16, 16, 16, 16], frozen: 7, merges, drawing: true, minRows: chartBottom, defaultHeight: 24, pageBreak: chartTop,
      heights: { ...Object.fromEntries(Array.from({ length: chartBottom - chartTop + 1 }, (_, index) => [chartTop + index + 1, 16])), 1: 30, 2: 10, 3: 26, 4: 32, 5: 28, 6: 26, 7: 10, 8: 32, 9: 30, 10: 10, 11: 10, 12: 26, 13: 32, 14: 36, 15: 32, 16: 10, ...rowHeights } }),
    'xl/worksheets/sheet2.xml': worksheet(details, { widths: [8, 32, 20, 30, 26, 30, 32, 26, 16, 18, 14, 16, 20, 26, 16], filter: true, heights: detailHeights }),
    'xl/worksheets/sheet3.xml': worksheet(typeTable, { widths: [30, 26, 16, 16, 18, 24, 22], filter: true }),
    'xl/worksheets/sheet4.xml': worksheet(bdTable, { widths: [34, 38, 26, 22, 16, 18, 26, 24], filter: true }),
  };
  const range = (column: string, start: number, count: number) => `'Summary'!$${column}$${start}:$${column}$${start + count - 1}`;
  parts['xl/charts/chart1.xml'] = chart('Given vs In Progress vs Not Given', ['Given', 'In Progress', 'Not Given'], range('A', overallStart, 3), [{ name: 'Clients', formula: range('B', overallStart, 3), values: [given, inProgress, pending], color: theme.green }], 'donut');
  parts['xl/charts/chart2.xml'] = chart('Type-wise Distribution', types.map(row => row.name), range('A', typeStart, types.length), [
    { name: 'Eligible clients', formula: range('B', typeStart, types.length), values: types.map(row => row.registered), color: theme.navy },
    { name: 'Given (any Requestee)', formula: range('C', typeStart, types.length), values: types.map(row => row.given), color: theme.orange },
  ], 'vertical');
  const positions = [[0, chartTop, 6, chartTop + 17], [6, chartTop, 12, chartTop + 17]];
  parts['xl/drawings/drawing1.xml'] = declaration + `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="${ns.drawing}">${positions.map(([left, top, right, bottom], index) => `<xdr:twoCellAnchor><xdr:from><xdr:col>${left}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${top}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${right}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${bottom}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${index + 1}" name="ADINN Chart ${index + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${ns.chart}"><c:chart xmlns:c="${ns.chart}" xmlns:r="${ns.rel}" r:id="rId${index + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`).join('')}</xdr:wsDr>`;
  parts['xl/drawings/_rels/drawing1.xml.rels'] = declaration + `<Relationships xmlns="${ns.package}">${[1, 2].map(index => `<Relationship Id="rId${index}" Type="${ns.rel}/chart" Target="../charts/chart${index}.xml"/>`).join('')}</Relationships>`;
  parts['xl/worksheets/_rels/sheet1.xml.rels'] = declaration + `<Relationships xmlns="${ns.package}"><Relationship Id="rIdDrawing" Type="${ns.rel}/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
  const sheetNames = ['Summary', 'Distribution Details', 'Type Analytics', 'Requestee Analytics'];
  const printAreas = [`A1:L${chartBottom + 1}`, `A1:O${details.length}`, `A1:G${typeTable.length}`, `A1:H${bdTable.length}`];
  parts['xl/workbook.xml'] = declaration + `<workbook xmlns="${ns.sheet}" xmlns:r="${ns.rel}"><bookViews><workbookView/></bookViews><sheets>${sheetNames.map((name, index) => `<sheet name="${name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets><definedNames>${sheetNames.map((name, index) => `<definedName name="_xlnm.Print_Titles" localSheetId="${index}">'${xml(name)}'!$1:$${index ? 1 : 6}</definedName><definedName name="_xlnm.Print_Area" localSheetId="${index}">'${xml(name)}'!${printAreas[index]}</definedName>`).join('')}</definedNames></workbook>`;
  parts['xl/_rels/workbook.xml.rels'] = declaration + `<Relationships xmlns="${ns.package}">${[1, 2, 3, 4].map(index => `<Relationship Id="rId${index}" Type="${ns.rel}/worksheet" Target="worksheets/sheet${index}.xml"/>`).join('')}<Relationship Id="rIdStyles" Type="${ns.rel}/styles" Target="styles.xml"/></Relationships>`;
  parts['_rels/.rels'] = declaration + `<Relationships xmlns="${ns.package}"><Relationship Id="rIdWorkbook" Type="${ns.rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  parts['[Content_Types].xml'] = declaration + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${[1, 2, 3, 4].map(index => `<Override PartName="/xl/worksheets/sheet${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>${[1, 2].map(index => `<Override PartName="/xl/charts/chart${index}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('')}</Types>`;
  const archive = XLSX.CFB.utils.cfb_new();
  for (const [name, content] of Object.entries(parts)) XLSX.CFB.utils.cfb_add(archive, name, new TextEncoder().encode(content));
  const data = XLSX.CFB.write(archive, { type: 'array', fileType: 'zip', compression: true }) as Uint8Array;
  return new Blob([new Uint8Array(data).buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
