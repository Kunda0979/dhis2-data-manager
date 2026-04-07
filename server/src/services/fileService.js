const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
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

/**
 * Convert JSON data to a simple PDF report buffer.
 */
function jsonToPdf(data, { title = 'DHIS2 Export' } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 36, size: 'A4' });
    const chunks = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const rows = Array.isArray(data) ? data : [];
    const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

    doc.fontSize(16).text(title);
    doc.moveDown(0.25);
    doc.fontSize(10).fillColor('#475569').text(`Generated: ${new Date().toISOString()}`);
    doc.text(`Record count: ${rows.length}`);
    doc.moveDown();

    if (rows.length === 0) {
      doc.fontSize(11).fillColor('#111827').text('No records available for the selected filters.');
      doc.end();
      return;
    }

    rows.forEach((row, index) => {
      doc.fontSize(11).fillColor('#0f172a').text(`Record ${index + 1}`, { underline: true });
      const keys = columns.length > 0 ? columns : Object.keys(row || {});
      for (const key of keys) {
        const value = row?.[key];
        const rendered = value === null || value === undefined
          ? ''
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
        doc.fontSize(9).fillColor('#111827').text(`${key}: ${rendered}`);
      }
      doc.moveDown(0.5);
    });

    doc.end();
  });
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

function columnNumberToName(colNumber) {
  let n = colNumber;
  let name = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function buildOptionListRanges(wb, columns) {
  const rangesByKey = {};
  const optionColumns = (columns || []).filter((col) => Array.isArray(col.options) && col.options.length > 0);
  if (optionColumns.length === 0) return rangesByKey;

  const wsLists = wb.addWorksheet('Lists');
  let listCol = 1;

  for (const col of optionColumns) {
    const uniqueOptions = [];
    const seen = new Set();
    for (const raw of col.options) {
      const value = String(raw || '').trim();
      if (!value || seen.has(value)) continue;
      seen.add(value);
      uniqueOptions.push(value);
    }
    if (uniqueOptions.length === 0) continue;

    wsLists.getCell(1, listCol).value = String(col.label || col.key || `list_${listCol}`).slice(0, 100);
    uniqueOptions.forEach((value, idx) => {
      wsLists.getCell(idx + 2, listCol).value = value;
    });

    const colLetter = columnNumberToName(listCol);
    rangesByKey[col.key] = `Lists!$${colLetter}$2:$${colLetter}$${uniqueOptions.length + 1}`;
    listCol += 1;
  }

  wsLists.state = 'veryHidden';
  return rangesByKey;
}

function isDateValueType(valueType) {
  const type = String(valueType || '').toUpperCase();
  return type === 'DATE' || type === 'DATETIME';
}

function isNumericValueType(valueType) {
  const type = String(valueType || '').toUpperCase();
  return ['INTEGER', 'INTEGER_POSITIVE', 'INTEGER_NEGATIVE', 'INTEGER_ZERO_OR_POSITIVE', 'NUMBER', 'PERCENTAGE', 'UNIT_INTERVAL', 'AGE'].includes(type);
}

function isBooleanValueType(valueType) {
  const type = String(valueType || '').toUpperCase();
  return type === 'BOOLEAN' || type === 'TRUE_ONLY';
}

function applyDataValidationForColumn(ws, colIndex, valueType, rowStart, rowEnd, listFormulaRange = null) {
  for (let rowNumber = rowStart; rowNumber <= rowEnd; rowNumber++) {
    const cell = ws.getCell(rowNumber, colIndex);

    if (listFormulaRange) {
      cell.dataValidation = {
        type: 'list',
        formulae: [listFormulaRange],
        allowBlank: true,
        showErrorMessage: true,
        errorTitle: 'Invalid selection',
        error: 'Choose a value from the list.',
      };
      continue;
    }

    if (isDateValueType(valueType)) {
      cell.dataValidation = {
        type: 'date',
        operator: 'greaterThan',
        formulae: [new Date('1900-01-01')],
        showErrorMessage: true,
        errorTitle: 'Invalid date',
        error: 'Use a valid date in YYYY-MM-DD format.',
      };
    } else if (isNumericValueType(valueType)) {
      cell.dataValidation = {
        type: 'decimal',
        operator: 'between',
        formulae: [-999999999, 999999999],
        showErrorMessage: true,
        errorTitle: 'Invalid number',
        error: 'Enter a numeric value only.',
      };
    } else if (isBooleanValueType(valueType)) {
      cell.dataValidation = {
        type: 'list',
        formulae: ['"true,false"'],
        showErrorMessage: true,
        errorTitle: 'Invalid value',
        error: 'Choose true or false.',
      };
    }
  }
}

function styleDataEntryCell(cell, required) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };
  cell.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: required ? 'FFFFF7CC' : 'FFF8FAFC' },
  };
  cell.protection = { locked: false };
}

function buildHorizontalValidationFormula(rowNumber, firstDataCol, lastDataCol, requiredCols = []) {
  const dataRange = `${columnNumberToName(firstDataCol)}${rowNumber}:${columnNumberToName(lastDataCol)}${rowNumber}`;
  if (!requiredCols.length) {
    return `IF(COUNTA(${dataRange})=0,"",IF(COUNTA(${dataRange})>0,"OK",""))`;
  }

  const requiredRefs = requiredCols.map((col) => `${columnNumberToName(col)}${rowNumber}`).join(',');
  return `IF(COUNTA(${dataRange})=0,"",IF(COUNTA(${requiredRefs})=${requiredCols.length},"OK","Missing required fields"))`;
}

function addValidationConditionalFormatting(ws, validationCol, dataStartRow, dataEndRow) {
  const colLetter = columnNumberToName(validationCol);
  const ref = `${colLetter}${dataStartRow}:${colLetter}${dataEndRow}`;

  ws.addConditionalFormatting({
    ref,
    rules: [
      {
        type: 'expression',
        formulae: [`${colLetter}${dataStartRow}="OK"`],
        style: {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            bgColor: { argb: 'FFECFDF5' },
            fgColor: { argb: 'FFD1FAE5' },
          },
          font: { color: { argb: 'FF065F46' }, bold: true },
        },
      },
      {
        type: 'expression',
        formulae: [`${colLetter}${dataStartRow}="Missing required fields"`],
        style: {
          fill: {
            type: 'pattern',
            pattern: 'solid',
            bgColor: { argb: 'FFFEF2F2' },
            fgColor: { argb: 'FFFEE2E2' },
          },
          font: { color: { argb: 'FF991B1B' }, bold: true },
        },
      },
    ],
  });
}

async function buildTemplateWorkbook({
  rows = [],
  sections = [],
  dataType = 'events',
  programMeta = null,
  templateSettings = {},
}) {
  const wb = new ExcelJS.Workbook();
  const wsStart = wb.addWorksheet('Start Here');
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
        options: Array.isArray(question.options) ? question.options : [],
      });
    }
  }

  const fallbackColumns = rows[0] ? Object.keys(rows[0]).map((key) => ({ key, label: key, valueType: 'TEXT', required: false, sectionName: 'Template Fields' })) : [];
  const columns = flatQuestions.length > 0 ? flatQuestions : fallbackColumns;
  const optionRanges = buildOptionListRanges(wb, columns);

  const layout = templateSettings.layout === 'vertical' ? 'vertical' : 'horizontal';
  const dataStartRow = layout === 'vertical' ? 2 : 5;
  const dataEndRow = dataStartRow + 250;

  wsStart.columns = [
    { header: 'Step', key: 'step', width: 20 },
    { header: 'Instructions', key: 'instruction', width: 120 },
  ];
  applyTemplateHeaderStyle(wsStart.getCell('A1'), 'FFFDE68A');
  applyTemplateHeaderStyle(wsStart.getCell('B1'), 'FFFDE68A');
  wsStart.addRow({ step: '1', instruction: 'Go to the Data sheet and fill only the shaded input cells. Required fields are highlighted in pale yellow.' });
  wsStart.addRow({ step: '2', instruction: 'Do not edit header rows, hidden key rows, or reference sheets.' });
  wsStart.addRow({ step: '3', instruction: 'Dates should be entered as YYYY-MM-DD. Dropdown fields have limited allowed values.' });
  wsStart.addRow({ step: '4', instruction: 'Review the Validation Notes column in the Data sheet. Rows marked OK are ready to import.' });
  wsStart.addRow({ step: '5', instruction: 'After filling rows, upload this file from the Import page.' });
  wsStart.addRow({ step: 'Legend', instruction: 'Validation Notes colors: green = ready to import, red = missing required fields.' });
  wsStart.addRow({ step: 'Template Type', instruction: dataType });
  wsStart.addRow({ step: 'Program', instruction: programMeta?.displayName || 'Not selected' });
  wsStart.addRow({ step: 'Org Unit Scope', instruction: templateSettings.orgUnitScope || 'all' });
  wsStart.addRow({ step: 'Language', instruction: templateSettings.language || 'en' });

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

      for (let rowNumber = 2; rowNumber <= wsData.rowCount; rowNumber++) {
        const valueCell = wsData.getCell(rowNumber, 5);
        const required = String(wsData.getCell(rowNumber, 3).value || '').endsWith(' *');
        styleDataEntryCell(valueCell, required);

        const valueType = wsData.getCell(rowNumber, 4).value;
        const keyRaw = String(wsData.getCell(rowNumber, 3).value || '');
        const key = keyRaw.endsWith(' *') ? keyRaw.slice(0, -2) : keyRaw;
        applyDataValidationForColumn(wsData, 5, valueType, rowNumber, rowNumber, optionRanges[key] || null);
      }

      wsData.getColumn(3).hidden = true;

      wsData.views = [{ state: 'frozen', ySplit: 1 }];
    } else {
      const dataStartCol = 2;
      const requiredColIndexes = [];

      let col = dataStartCol;
      while (col <= columns.length + 1) {
        const sectionName = columns[col - dataStartCol].sectionName || 'Section';
        let end = col;
        while (end <= columns.length + 1 && (columns[end - dataStartCol].sectionName || 'Section') === sectionName) {
          end += 1;
        }
        wsData.mergeCells(1, col, 1, end - 1);
        const sectionCell = wsData.getCell(1, col);
        sectionCell.value = sectionName;
        applyTemplateHeaderStyle(sectionCell, 'FF93C5FD');
        col = end;
      }

      columns.forEach((column, index) => {
        const c = index + dataStartCol;
        if (column.required) requiredColIndexes.push(c);

        const qCell = wsData.getCell(2, c);
        qCell.value = column.label;
        applyTemplateHeaderStyle(qCell, column.required ? 'FFFCD34D' : 'FF60A5FA');
        qCell.note = column.required
          ? 'Required field. Please provide a value before import.'
          : 'Optional field.';

        const keyCell = wsData.getCell(3, c);
        keyCell.value = `${column.key}${column.required ? ' *' : ''}`;
        applyTemplateHeaderStyle(keyCell, 'FFBFDBFE');

        const typeCell = wsData.getCell(4, c);
        typeCell.value = column.valueType || 'TEXT';
        applyTemplateHeaderStyle(typeCell, 'FFE2E8F0');

        wsData.getColumn(c).width = Math.max(18, Math.min(44, Math.ceil((column.label || '').length * 0.9)));
      });

      const validationCol = 1;
      const validationSectionCell = wsData.getCell(1, validationCol);
      validationSectionCell.value = 'Template Checks';
      applyTemplateHeaderStyle(validationSectionCell, 'FFC7D2FE');

      const validationHeaderCell = wsData.getCell(2, validationCol);
      validationHeaderCell.value = 'Validation Notes';
      applyTemplateHeaderStyle(validationHeaderCell, 'FFA5B4FC');
      validationHeaderCell.note = 'This column is auto-generated. Do not edit.';

      const validationKeyCell = wsData.getCell(3, validationCol);
      validationKeyCell.value = 'validationNotes';
      applyTemplateHeaderStyle(validationKeyCell, 'FFC7D2FE');

      const validationTypeCell = wsData.getCell(4, validationCol);
      validationTypeCell.value = 'TEXT';
      applyTemplateHeaderStyle(validationTypeCell, 'FFE2E8F0');
      wsData.getColumn(validationCol).width = 32;

      const firstRow = rows[0] || {};
      const values = columns.map((column) => firstRow[column.key] ?? '');
      wsData.addRow(['', ...values]);
      wsData.addRow(['', ...columns.map(() => '')]);

      for (let rowNumber = dataStartRow; rowNumber <= dataEndRow; rowNumber++) {
        const checkCell = wsData.getCell(rowNumber, validationCol);
        checkCell.value = {
          formula: buildHorizontalValidationFormula(rowNumber, dataStartCol, columns.length + 1, requiredColIndexes),
          result: '',
        };
        checkCell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFEDE9FE' },
        };
        checkCell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
        };
        checkCell.font = { color: { argb: 'FF4C1D95' } };
      }

      addValidationConditionalFormatting(wsData, validationCol, dataStartRow, dataEndRow);

      for (let rowNumber = dataStartRow; rowNumber <= dataEndRow; rowNumber++) {
        columns.forEach((column, index) => {
          const c = index + dataStartCol;
          styleDataEntryCell(wsData.getCell(rowNumber, c), column.required);
        });
      }

      columns.forEach((column, index) => {
        applyDataValidationForColumn(
          wsData,
          index + dataStartCol,
          column.valueType,
          dataStartRow,
          dataEndRow,
          optionRanges[column.key] || null,
        );
      });

      // Keep validation formulas read-only while data-entry columns remain editable.
      wsData.getColumn(validationCol).eachCell((cell) => {
        cell.protection = { locked: true };
      });

      // Keep technical keys for parser compatibility, but hide them from end users.
      wsData.getRow(3).hidden = true;
      wsData.views = [{ state: 'frozen', ySplit: 4, xSplit: 1 }];
    }
  }

  await wsData.protect('template-lock', {
    selectLockedCells: true,
    selectUnlockedCells: true,
    formatCells: false,
    formatColumns: false,
    formatRows: false,
    insertColumns: false,
    insertRows: false,
    insertHyperlinks: false,
    deleteColumns: false,
    deleteRows: false,
    sort: false,
    autoFilter: false,
    pivotTables: false,
  });

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
      if (!key || key === 'validationNotes') continue;
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
        const normalized = raw.endsWith(' *') ? raw.slice(0, -2) : (raw || `col${i + 1}`);
        if (normalized === 'validationNotes') return null;
        return normalized;
      });
    } else if (rowNumber > headerRowIndex) {
      const obj = {};
      headers.forEach((h, i) => {
        if (!h) return;
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

module.exports = { jsonToCsv, jsonToExcel, jsonToPdf, buildTemplateWorkbook, csvToJson, excelToJson };
