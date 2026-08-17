function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const TRACKER_EXPORT_TYPES = new Set(['events', 'enrollments', 'trackedEntities']);

const EXPORT_TRACKER_REQUIRE_PROGRAM = process.env.EXPORT_TRACKER_REQUIRE_PROGRAM !== 'false';
const EXPORT_TRACKER_SCOPED_MAX_ROWS = parsePositiveInt(process.env.EXPORT_TRACKER_SCOPED_MAX_ROWS, 5000);
const EXPORT_TRACKER_UNSCOPED_MAX_ROWS = parsePositiveInt(process.env.EXPORT_TRACKER_UNSCOPED_MAX_ROWS, 500);
const EXPORT_TRACKER_PAGE_SIZE = parsePositiveInt(process.env.EXPORT_TRACKER_PAGE_SIZE, 100);

function isTrackerExportType(dataType) {
  return TRACKER_EXPORT_TYPES.has(dataType);
}

function buildProgramRequiredError(dataType) {
  const err = new Error(
    `${dataType} export requires a program filter. Select a program or ask an administrator to disable EXPORT_TRACKER_REQUIRE_PROGRAM.`
  );
  err.status = 400;
  return err;
}

function buildMaxRowsExceededError(dataType, maxRows, scopedMode) {
  const modeMessage = scopedMode === 'unscoped-strict-cap'
    ? 'Unscoped tracker exports are running in strict capped mode.'
    : 'Tracker export exceeded the configured safe row cap.';
  const err = new Error(`${modeMessage} Limit is ${maxRows} rows for ${dataType} exports.`);
  err.status = 413;
  return err;
}

function applyExportGuardrails(dataType, params = {}) {
  if (!isTrackerExportType(dataType)) {
    return {
      params,
      paging: null,
      scope: {
        mode: 'aggregate-or-non-tracker',
        hasProgram: true,
      },
    };
  }

  const hasProgram = Boolean(params.program);
  if (EXPORT_TRACKER_REQUIRE_PROGRAM && !hasProgram) {
    throw buildProgramRequiredError(dataType);
  }

  const mode = hasProgram ? 'scoped' : 'unscoped-strict-cap';
  const maxRows = hasProgram ? EXPORT_TRACKER_SCOPED_MAX_ROWS : EXPORT_TRACKER_UNSCOPED_MAX_ROWS;

  return {
    params,
    paging: {
      pageSize: EXPORT_TRACKER_PAGE_SIZE,
      maxRows,
      maxRowsErrorFactory: () => buildMaxRowsExceededError(dataType, maxRows, mode),
    },
    scope: {
      mode,
      hasProgram,
      maxRows,
    },
  };
}

module.exports = {
  applyExportGuardrails,
  isTrackerExportType,
};
