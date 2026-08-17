const { createDhis2Client } = require('./dhis2Client');
const { createAppError } = require('../utils/apiError');

function uniqueIds(ids = []) {
  return [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))];
}

function shouldSkipChecks() {
  return process.env.NODE_ENV === 'test' && process.env.ENABLE_PERMISSION_CHECKS_IN_TEST !== 'true';
}

async function resolveProgram(req, programId) {
  if (!programId) return null;
  const client = createDhis2Client(req);
  try {
    const response = await client.get(`/api/programs/${programId}`, {
      params: { fields: 'id,displayName,programStages[id,displayName]' },
    });
    return response.data;
  } catch {
    throw createAppError({
      status: 403,
      code: 'INSUFFICIENT_PROGRAM_ACCESS',
      message: `Insufficient permission for selected program (${programId})`,
      hint: 'Select a program you can access or ask your DHIS2 administrator for program read permission.',
    });
  }
}

async function ensureProgramAccess(req, programId, programStageId) {
  if (!programId && !programStageId) return;
  const program = await resolveProgram(req, programId);

  if (programStageId) {
    const stages = program?.programStages || [];
    const hasStage = stages.some((stage) => stage.id === programStageId);
    if (!hasStage) {
      throw createAppError({
        status: 403,
        code: 'INSUFFICIENT_PROGRAM_STAGE_ACCESS',
        message: `Insufficient permission for selected program stage (${programStageId})`,
        hint: 'Select a program stage available in your accessible program configuration.',
      });
    }
  }
}

async function ensureDataSetAccess(req, dataSetId) {
  if (!dataSetId) return;
  const client = createDhis2Client(req);
  try {
    await client.get(`/api/dataSets/${dataSetId}`, {
      params: { fields: 'id,displayName' },
    });
  } catch {
    throw createAppError({
      status: 403,
      code: 'INSUFFICIENT_DATASET_ACCESS',
      message: `Insufficient permission for selected dataset (${dataSetId})`,
      hint: 'Select a dataset you can access or ask your DHIS2 administrator for dataset read permission.',
    });
  }
}

async function ensureOrgUnitAccess(req, orgUnitIds = []) {
  const ids = uniqueIds(orgUnitIds);
  if (ids.length === 0) return;

  const client = createDhis2Client(req);

  const resolveOrgUnitName = async (id) => {
    if (!id) return '';
    try {
      const response = await client.get(`/api/organisationUnits/${id}`, {
        params: { fields: 'id,displayName,name' },
      });
      return String(response.data?.displayName || response.data?.name || '').trim();
    } catch {
      return '';
    }
  };

  for (const id of ids) {
    const response = await client.get('/api/organisationUnits', {
      params: {
        fields: 'id,displayName',
        paging: false,
        withinUserHierarchy: true,
        filter: `id:eq:${id}`,
      },
    });
    const units = response.data?.organisationUnits || [];
    if (!units.some((ou) => ou.id === id)) {
      const orgUnitName = await resolveOrgUnitName(id);
      const label = orgUnitName || id;
      throw createAppError({
        status: 403,
        code: 'INSUFFICIENT_ORGUNIT_ACCESS',
        message: `Insufficient permission for selected organisation unit (${label})`,
        hint: 'Choose organisation units within your hierarchy or request org unit access from an administrator.',
        details: {
          field: 'orgUnit',
          row: 1,
          orgUnitId: id,
          orgUnitName: label,
        },
      });
    }
  }
}

async function ensureSelectionAccess(req, selection = {}) {
  if (shouldSkipChecks()) return;

  const {
    programId,
    programStageId,
    dataSetId,
    orgUnitIds = [],
  } = selection;

  await ensureProgramAccess(req, programId, programStageId);
  await ensureDataSetAccess(req, dataSetId);
  await ensureOrgUnitAccess(req, orgUnitIds);
}

module.exports = {
  ensureProgramAccess,
  ensureDataSetAccess,
  ensureOrgUnitAccess,
  ensureSelectionAccess,
};