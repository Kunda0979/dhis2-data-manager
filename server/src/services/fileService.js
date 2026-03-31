const ExcelJS = require('exceljs');
const { stringify } = require('csv-stringify/sync');
const { parse } = require('csv-parse/sync');

const FORMULA_PREFIXES = ['=', '+', '-', '@'];

function sanitizeSpreadsheetValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.length > 0 && FORMULA_PREFIXES.includes(text[0])) {
    return `'${text}`;
  }
  return text;
}

function sanitizeSpreadsheetRow(row) {
  const safe = {};
  for (const [key, value] of Object.entries(row)) {
    safe[key] = sanitizeSpreadsheetValue(value);
  }
  return safe;
}

/**
 * Convert JSON data to CSV string.
 */
function jsonToCsv(data) {
  if (!Array.isArray(data) || data.length === 0) return '';
  const columns = Object.keys(data[0]);
  const safeData = data.map((row) => sanitizeSpreadsheetRow(row));
  return stringify(safeData, { header: true, columns });
}

/**
 * Convert JSON data to Excel buffer using ExcelJS.
 */
async function jsonToExcel(data) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');

  if (data.length > 0) {
    const headers = Object.keys(data[0]);
    ws.columns = headers.map((key) => ({ header: key, key, width: 20 }));
    for (const row of data) {
      ws.addRow(sanitizeSpreadsheetRow(row));
    }
  }

  return wb.xlsx.writeBuffer();
}

function looksLikeTemplateKey(value) {
  if (!value || typeof value !== 'string') return false;
  const v = value.trim();
  const baseKeys = new Set([
    'event', 'status', 'program', 'programStage', 'orgUnit', 'occurredAt', 'trackedEntity', 'enrollment',
    'trackedEntityType', 'enrolledAt', 'scheduledAt', 'eventDate', 'enrollmentDate', 'incidentDate',
  ]);
  if (baseKeys.has(v)) return true;
  return /^(de|attr|tea)_[A-Za-z0-9]{11}(?:__.*)?$/.test(v);
}

function detectHeaderRowIndex(ws) {
  const maxRows = Math.min(ws.rowCount || 1, 8);
  let best = { row: 1, score: 0 };

  for (let rowNumber = 1; rowNumber <= maxRows; rowNumber++) {
    const row = ws.getRow(rowNumber);
    const values = row.values.slice(1).map((v) => (v === null || v === undefined ? '' : String(v).trim())).filter(Boolean);
    if (values.length === 0) continue;
    const hits = values.filter((v) => looksLikeTemplateKey(v)).length;
    const score = hits / values.length;
    if (score > best.score) {
      best = { row: rowNumber, score };
    }
  }

  return best.score >= 0.3 ? best.row : 1;
}

function applyTemplateHeaderStyle(cell, fillColor) {
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: fillColor },
  };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.font = { bold: true, color: { argb: 'FF0F172A' } };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FF1E293B' } },
    left: { style: 'thin', color: { argb: 'FF1E293B' } },
    bottom: { style: 'thin', color: { argb: 'FF1E293B' } },
    right: { style: 'thin', color: { argb: 'FF1E293B' } },
  };
}

async function buildTemplateWorkbook({
  rows = [],
  sections = [],
  dataType = 'events',
  programMeta = null,
  templateSettings = {},
}) {
  const wb = new ExcelJS.Workbook();
  const wsData = wb.addWorksheet('Data');

  const flatQuestions = [];
  for (const section of sections || []) {
    for (const question of section.questions || []) {
      flatQuestions.push({
        key: question.key,
        label: question.label || question.key,
        valueType: question.valueType || 'TEXT',
        required: Boolean(question.required),
        sectionName: section.name || 'Section',
      });
    }
  }

  const fallbackColumns = rows[0] ? Object.keys(rows[0]).map((key) => ({ key, label: key, valueType: 'TEXT', required: false, sectionName: 'Template Fields' })) : [];
  const columns = flatQuestions.length > 0 ? flatQuestions : fallbackColumns;

  const layout = templateSettings.layout === 'vertical' ? 'vertical' : 'horizontal';

  if (columns.length > 0) {
    if (layout === 'vertical') {
      wsData.columns = [
        { header: 'Section', key: 'section', width: 28 },
        { header: 'Question', key: 'question', width: 42 },
        { header: 'Key', key: 'key', width: 36 },
        { header: 'Value Type', key: 'valueType', width: 18 },
        { header: 'Value', key: 'value', width: 28 },
      ];

      ['A1', 'B1', 'C1', 'D1', 'E1'].forEach((address) => {
        applyTemplateHeaderStyle(wsData.getCell(address), 'FF93C5FD');
      });

      const firstRow = rows[0] || {};
      for (const column of columns) {
        wsData.addRow({
          section: column.sectionName || 'Template Fields',
          question: column.label,
          key: `${column.key}${column.required ? ' *' : ''}`,
          valueType: column.valueType || 'TEXT',
          value: firstRow[column.key] ?? '',
        });
      }

      wsData.views = [{ state: 'frozen', ySplit: 1 }];
    } else {
      let col = 1;
      while (col <= columns.length) {
        const sectionName = columns[col - 1].sectionName || 'Section';
        let end = col;
        while (end <= columns.length && (columns[end - 1].sectionName || 'Section') === sectionName) {
          end += 1;
        }
        wsData.mergeCells(1, col, 1, end - 1);
        const sectionCell = wsData.getCell(1, col);
        sectionCell.value = sectionName;
        applyTemplateHeaderStyle(sectionCell, 'FF93C5FD');
        col = end;
      }

      columns.forEach((column, index) => {
        const c = index + 1;
        const qCell = wsData.getCell(2, c);
        qCell.value = column.label;
        applyTemplateHeaderStyle(qCell, 'FF60A5FA');

        const keyCell = wsData.getCell(3, c);
        keyCell.value = `${column.key}${column.required ? ' *' : ''}`;
        applyTemplateHeaderStyle(keyCell, 'FFBFDBFE');

        const typeCell = wsData.getCell(4, c);
        typeCell.value = column.valueType || 'TEXT';
        applyTemplateHeaderStyle(typeCell, 'FFE2E8F0');

        wsData.getColumn(c).width = Math.max(18, Math.min(44, Math.ceil((column.label || '').length * 0.9)));
      });

      const firstRow = rows[0] || {};
      const values = columns.map((column) => firstRow[column.key] ?? '');
      wsData.addRow(values);

      // Keep technical keys for parser compatibility, but hide them from end users.
      wsData.getRow(3).hidden = true;
      wsData.views = [{ state: 'frozen', ySplit: 4 }];
    }
  }

  const wsInstructions = wb.addWorksheet('Instructions');
  wsInstructions.columns = [{ header: 'Field', key: 'field', width: 26 }, { header: 'Value', key: 'value', width: 120 }];
  wsInstructions.addRow({ field: 'How to use', value: 'Fill values in the Data sheet row(s). Import the completed file back through the Import page.' });
  wsInstructions.addRow({ field: 'Template type', value: dataType });
  wsInstructions.addRow({ field: 'Program', value: programMeta?.displayName || '' });
  wsInstructions.addRow({ field: 'Program ID', value: programMeta?.id || '' });
  wsInstructions.addRow({ field: 'Organisation unit scope', value: templateSettings.orgUnitScope || 'all' });
  wsInstructions.addRow({ field: 'Selected org units', value: (templateSettings.orgUnitIds || []).join(', ') });
  wsInstructions.addRow({ field: 'Language', value: templateSettings.language || 'en' });
  wsInstructions.addRow({ field: 'Layout', value: layout });

  const wsProgram = wb.addWorksheet('Program');
  wsProgram.columns = [
    { header: 'Program ID', key: 'id', width: 22 },
    { header: 'Program Name', key: 'name', width: 48 },
    { header: 'Program Type', key: 'type', width: 24 },
    { header: 'Tracked Entity Type', key: 'tet', width: 32 },
  ];
  wsProgram.addRow({
    id: programMeta?.id || '',
    name: programMeta?.displayName || '',
    type: programMeta?.programType || '',
    tet: programMeta?.trackedEntityType?.displayName || '',
  });

  const wsOrgUnits = wb.addWorksheet('OrgUnits');
  wsOrgUnits.columns = [
    { header: 'Org Unit ID', key: 'id', width: 22 },
    { header: 'Org Unit Name', key: 'name', width: 42 },
  ];
  for (const id of templateSettings.orgUnitIds || []) {
    wsOrgUnits.addRow({ id, name: '' });
  }

  const wsElements = wb.addWorksheet('Data Elements');
  wsElements.columns = [
    { header: 'Section', key: 'section', width: 30 },
    { header: 'Question', key: 'label', width: 48 },
    { header: 'Key', key: 'key', width: 36 },
    { header: 'Value Type', key: 'type', width: 20 },
    { header: 'Required', key: 'required', width: 12 },
  ];
  for (const col of columns) {
    wsElements.addRow({
      section: col.sectionName || 'Template Fields',
      label: col.label,
      key: col.key,
      type: col.valueType || 'TEXT',
      required: col.required ? 'Yes' : 'No',
    });
  }

  return wb.xlsx.writeBuffer();
}

/**
 * Parse CSV buffer/string to JSON array.
 */
function csvToJson(csvData) {
  return parse(csvData, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

/**
 * Parse Excel buffer to JSON array using ExcelJS (reads first sheet).
 */
async function excelToJson(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const ws = wb.getWorksheet('Data') || wb.worksheets[0];
  if (!ws) return [];

  const rows = [];
  let headers = [];
  const possibleHeader = ws.getRow(1).values.slice(1).map((v) => (v === null || v === undefined ? '' : String(v).trim().toLowerCase()));

  const keyCol = possibleHeader.indexOf('key');
  const valueCol = possibleHeader.indexOf('value');
  if (keyCol >= 0 && valueCol >= 0) {
    const rowObj = {};
    for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber++) {
      const row = ws.getRow(rowNumber).values.slice(1);
      const keyCell = row[keyCol];
      const valueCell = row[valueCol];
      if (keyCell === null || keyCell === undefined) continue;
      const keyRaw = String(keyCell).trim();
      if (!keyRaw) continue;
      const key = keyRaw.endsWith(' *') ? keyRaw.slice(0, -2) : keyRaw;
      rowObj[key] = valueCell !== null && valueCell !== undefined ? String(valueCell) : '';
    }
    return Object.keys(rowObj).length > 0 ? [rowObj] : [];
  }

  const headerRowIndex = detectHeaderRowIndex(ws);

  ws.eachRow((row, rowNumber) => {
    const values = row.values.slice(1); // ExcelJS uses 1-based, index 0 is empty
    if (rowNumber === headerRowIndex) {
      headers = values.map((v, i) => {
        const raw = v !== null && v !== undefined ? String(v).trim() : '';
        return raw.endsWith(' *') ? raw.slice(0, -2) : (raw || `col${i + 1}`);
      });
    } else if (rowNumber > headerRowIndex) {
      const obj = {};
      headers.forEach((h, i) => {
        const cell = values[i];
        obj[h] = cell !== null && cell !== undefined ? String(cell) : '';
      });
      const hasAnyValue = Object.values(obj).some((v) => String(v).trim() !== '');
      if (!hasAnyValue) return;
      rows.push(obj);
    }
  });

  return rows;
}

module.exports = { jsonToCsv, jsonToExcel, buildTemplateWorkbook, csvToJson, excelToJson };
