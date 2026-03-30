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
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const rows = [];
  let headers = [];

  ws.eachRow((row, rowNumber) => {
    const values = row.values.slice(1); // ExcelJS uses 1-based, index 0 is empty
    if (rowNumber === 1) {
      headers = values.map((v, i) => (v !== null && v !== undefined ? String(v) : `col${i + 1}`));
    } else {
      const obj = {};
      headers.forEach((h, i) => {
        const cell = values[i];
        obj[h] = cell !== null && cell !== undefined ? String(cell) : '';
      });
      rows.push(obj);
    }
  });

  return rows;
}

module.exports = { jsonToCsv, jsonToExcel, csvToJson, excelToJson };
