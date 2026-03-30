const express = require('express');
const { requireDhis2Credentials } = require('../middleware/auth');
const { createDhis2Client } = require('../services/dhis2Client');

const router = express.Router();

router.use(requireDhis2Credentials);

/**
 * GET /api/metadata/programs
 * Fetch all programs with stages.
 */
router.get('/programs', async (req, res, next) => {
  try {
    const client = createDhis2Client(req);
    const response = await client.get('/api/programs', {
      params: {
        fields: 'id,displayName,programType,programStages[id,displayName,sortOrder]',
        paging: false,
      },
    });
    res.json(response.data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/metadata/orgUnits
 * Fetch org units tree.
 */
router.get('/orgUnits', async (req, res, next) => {
  try {
    const client = createDhis2Client(req);
    const response = await client.get('/api/organisationUnits', {
      params: {
        fields: 'id,displayName,level,path,parent[id,displayName]',
        paging: false,
        level: req.query.level || undefined,
      },
    });
    res.json(response.data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/metadata/trackedEntityTypes
 */
router.get('/trackedEntityTypes', async (req, res, next) => {
  try {
    const client = createDhis2Client(req);
    const response = await client.get('/api/trackedEntityTypes', {
      params: {
        fields: 'id,displayName,trackedEntityTypeAttributes[trackedEntityAttribute[id,displayName,valueType]]',
        paging: false,
      },
    });
    res.json(response.data);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/metadata/dataElements
 * Fetch data elements (optionally filtered by program stage).
 */
router.get('/dataElements', async (req, res, next) => {
  try {
    const client = createDhis2Client(req);
    const params = {
      fields: 'id,displayName,valueType',
      paging: false,
    };
    if (req.query.programStage) {
      params.filter = `programStageDataElements.programStage.id:eq:${req.query.programStage}`;
    }
    const response = await client.get('/api/dataElements', { params });
    res.json(response.data);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
