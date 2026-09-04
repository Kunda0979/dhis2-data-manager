const express = require('express');
const { requireDhis2Credentials } = require('../middleware/auth');
const { createDhis2Client } = require('../services/dhis2Client');
const {
  SAFE_METADATA_CACHE_TTL_SEC,
  buildMetadataScope,
  buildCacheKey,
  getOrSetMetadataCache,
  getMetadataCacheStatus,
} = require('../services/metadataCacheService');

const router = express.Router();

router.use(requireDhis2Credentials);

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).toLowerCase();
  if (normalized === 'true' || normalized === '1') return true;
  if (normalized === 'false' || normalized === '0') return false;
  return fallback;
}

function toPositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function withMetadataCache(req, endpoint, params, loader) {
  const scope = buildMetadataScope(req);
  const forceRefresh = toBoolean(req.query.refresh, false);
  const cacheKey = buildCacheKey(endpoint, params);
  const { data, cached } = await getOrSetMetadataCache(scope, cacheKey, loader, {
    forceRefresh,
    ttlSec: SAFE_METADATA_CACHE_TTL_SEC,
  });
  return { data, cached };
}

/**
 * GET /api/metadata/cache/status
 * Inspect metadata cache occupancy and hit/miss metrics.
 */
router.get('/cache/status', (req, res) => {
  const scope = String(req.query.scope || 'session').toLowerCase();
  const sessionId = scope === 'global' ? undefined : req.authSession?.id;
  const status = getMetadataCacheStatus({ sessionId });

  res.json({
    scope,
    ...status,
  });
});

/**
 * GET /api/metadata/programs
 * Fetch all programs with stages.
 */
router.get('/programs', async (req, res, next) => {
  try {
    const client = createDhis2Client(req);
    const params = {
      fields: 'id,displayName,programType,programStages[id,displayName,sortOrder]',
      paging: false,
    };

    const { data, cached } = await withMetadataCache(req, 'programs', params, async () => {
      const response = await client.get('/api/programs', { params });
      return response.data;
    });

    res.json({ ...data, cached });
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

    const page = toPositiveInt(req.query.page, 1);
    const pageSize = Math.min(toPositiveInt(req.query.pageSize, 50), 200);
    const level = req.query.level ? toPositiveInt(req.query.level, undefined) : undefined;
    const parentId = req.query.parentId ? String(req.query.parentId).trim() : '';
    const search = req.query.search ? String(req.query.search).trim() : '';
    const ids = req.query.ids
      ? String(req.query.ids).split(',').map((id) => id.trim()).filter(Boolean)
      : [];
    const withinUserHierarchy = toBoolean(req.query.withinUserHierarchy, true);

    if (ids.length > 0) {
      const fields = 'id,displayName,level,path,parent[id,displayName]';
      const params = { ids, fields, withinUserHierarchy };
      const { data, cached } = await withMetadataCache(req, 'orgUnitsByIds', params, async () => {
        const results = await Promise.all(ids.map(async (id) => {
          try {
            const response = await client.get(`/api/organisationUnits/${id}`, {
              params: { fields },
            });
            return response.data;
          } catch {
            return null;
          }
        }));

        return {
          organisationUnits: results.filter(Boolean),
          pager: {
            page: 1,
            pageSize: ids.length,
            total: ids.length,
            pageCount: 1,
          },
        };
      });

      return res.json({ ...data, cached });
    }

    const params = {
      fields: 'id,displayName,level,path,parent[id,displayName]',
      page,
      pageSize,
      paging: true,
      withinUserHierarchy,
      level,
      order: 'displayName:asc',
    };

    if (parentId) {
      params.filter = `parent.id:eq:${parentId}`;
    } else if (search) {
      params.filter = `displayName:ilike:${search}`;
    }

    const { data, cached } = await withMetadataCache(req, 'orgUnits', params, async () => {
      const response = await client.get('/api/organisationUnits', { params });
      return response.data;
    });

    res.json({ ...data, cached });
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
    const params = {
      fields: 'id,displayName,trackedEntityTypeAttributes[trackedEntityAttribute[id,displayName,valueType]]',
      paging: false,
    };

    const { data, cached } = await withMetadataCache(req, 'trackedEntityTypes', params, async () => {
      const response = await client.get('/api/trackedEntityTypes', { params });
      return response.data;
    });

    res.json({ ...data, cached });
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

    const { data, cached } = await withMetadataCache(req, 'dataElements', params, async () => {
      const response = await client.get('/api/dataElements', { params });
      return response.data;
    });

    res.json({ ...data, cached });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/metadata/dataSets
 */
router.get('/dataSets', async (req, res, next) => {
  try {
    const client = createDhis2Client(req);
    const params = {
      fields: 'id,displayName,periodType',
      paging: false,
    };

    const { data, cached } = await withMetadataCache(req, 'dataSets', params, async () => {
      const response = await client.get('/api/dataSets', { params });
      return response.data;
    });

    res.json({ ...data, cached });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
