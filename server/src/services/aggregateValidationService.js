const { createDhis2Client } = require('./dhis2Client');

function normalizeViolation(item = {}, index = 0) {
  const ruleName = item.validationRule?.displayName
    || item.validationRule?.name
    || item.validationRule?.id
    || item.displayName
    || item.name
    || item.ruleName
    || `Violation ${index + 1}`;

  const leftValue = item.leftsideValue ?? item.leftValue ?? item.leftside ?? null;
  const rightValue = item.rightsideValue ?? item.rightValue ?? item.rightside ?? null;
  const operator = item.operator || item.validationRule?.operator || '';

  return {
    id: item.validationRule?.id || item.id || null,
    rule: ruleName,
    leftValue,
    rightValue,
    operator,
    importance: item.importance || item.validationRule?.importance || null,
    message: item.comment || item.description || item.message || '',
  };
}

function normalizeValidationResponse(responseData, scope) {
  const violationsRaw = [];

  if (Array.isArray(responseData?.validationRuleViolations)) {
    violationsRaw.push(...responseData.validationRuleViolations);
  }
  if (Array.isArray(responseData?.validationResults)) {
    violationsRaw.push(...responseData.validationResults);
  }
  if (Array.isArray(responseData?.violations)) {
    violationsRaw.push(...responseData.violations);
  }

  const violations = violationsRaw.map((item, index) => normalizeViolation(item, index));

  return {
    scope,
    status: violations.length === 0 ? 'passed' : 'failed',
    violationCount: violations.length,
    violations,
  };
}

async function runDataSetValidation(req, { dataSet, orgUnit, period }) {
  const client = createDhis2Client(req);
  const scope = {
    dataSet: String(dataSet || '').trim(),
    orgUnit: String(orgUnit || '').trim(),
    period: String(period || '').trim(),
  };

  if (!scope.dataSet || !scope.orgUnit || !scope.period) {
    return {
      scope,
      status: 'failed',
      violationCount: 1,
      violations: [{
        id: null,
        rule: 'Missing dataset validation scope',
        message: 'Dataset validation requires dataSet, orgUnit, and period.',
        leftValue: null,
        rightValue: null,
        operator: '',
        importance: null,
      }],
      unavailable: false,
    };
  }

  const attempts = [
    {
      path: '/api/dataAnalysis/validation',
      params: {
        dataSet: scope.dataSet,
        orgUnit: scope.orgUnit,
        period: scope.period,
      },
    },
    {
      path: '/api/dataAnalysis/validation.json',
      params: {
        dataSet: scope.dataSet,
        orgUnit: scope.orgUnit,
        period: scope.period,
      },
    },
    {
      path: '/api/validationResults',
      params: {
        dataSet: scope.dataSet,
        ou: scope.orgUnit,
        pe: scope.period,
        paging: false,
      },
    },
  ];

  let lastErr = null;
  for (const attempt of attempts) {
    try {
      const response = await client.get(attempt.path, { params: attempt.params });
      return {
        ...normalizeValidationResponse(response.data || {}, scope),
        unavailable: false,
      };
    } catch (err) {
      const status = err?.response?.status;
      if (status === 404) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }

  if (lastErr) {
    return {
      scope,
      status: 'failed',
      violationCount: 1,
      violations: [{
        id: null,
        rule: 'Dataset validation endpoint unavailable',
        message: 'DHIS2 dataset validation endpoint is not available on this instance.',
        leftValue: null,
        rightValue: null,
        operator: '',
        importance: null,
      }],
      unavailable: true,
    };
  }

  return {
    scope,
    status: 'passed',
    violationCount: 0,
    violations: [],
    unavailable: false,
  };
}

function buildCompletionRegistration(scope, { completionDate } = {}) {
  const registration = {
    dataSet: scope.dataSet,
    period: scope.period,
    organisationUnit: scope.orgUnit,
  };
  if (scope.attributeOptionCombo) {
    registration.attributeOptionCombo = scope.attributeOptionCombo;
  }
  if (completionDate) {
    registration.date = completionDate;
  }
  return registration;
}

async function registerDataSetCompletion(req, scope, options = {}) {
  const client = createDhis2Client(req);
  const registration = buildCompletionRegistration(scope, options);

  const response = await client.post('/api/completeDataSetRegistrations', {
    completeDataSetRegistrations: [registration],
  });

  return response.data;
}

async function unregisterDataSetCompletion(req, scope) {
  const client = createDhis2Client(req);
  const params = {
    ds: scope.dataSet,
    pe: scope.period,
    ou: scope.orgUnit,
  };
  if (scope.attributeOptionCombo) {
    params.aoc = scope.attributeOptionCombo;
  }

  const response = await client.delete('/api/completeDataSetRegistrations', { params });
  return response.data;
}

function normalizeCompletionRegistration(item = {}, scope = {}) {
  const normalizedScope = {
    dataSet: String(item.dataSet || item.ds || scope.dataSet || '').trim(),
    period: String(item.period || item.pe || scope.period || '').trim(),
    orgUnit: String(item.organisationUnit || item.orgUnit || item.ou || scope.orgUnit || '').trim(),
    attributeOptionCombo: String(item.attributeOptionCombo || item.aoc || scope.attributeOptionCombo || '').trim(),
  };

  return {
    dataSet: normalizedScope.dataSet,
    period: normalizedScope.period,
    organisationUnit: normalizedScope.orgUnit,
    attributeOptionCombo: normalizedScope.attributeOptionCombo,
    completedOn: item.date || item.completed || item.created || item.lastUpdated || null,
    completedBy: item.storedBy || item.user?.displayName || item.user?.name || item.username || null,
    raw: item,
  };
}

async function getDataSetCompletionStatus(req, scope) {
  const client = createDhis2Client(req);
  const params = {
    ds: String(scope?.dataSet || '').trim(),
    pe: String(scope?.period || '').trim(),
    ou: String(scope?.orgUnit || '').trim(),
    paging: false,
  };
  if (scope?.attributeOptionCombo) {
    params.aoc = String(scope.attributeOptionCombo).trim();
  }

  let response;
  try {
    response = await client.get('/api/completeDataSetRegistrations', { params });
  } catch (err) {
    if (err?.response?.status === 404) {
      return {
        scope,
        isCompleted: false,
        registration: null,
        checkedAt: new Date().toISOString(),
        unavailable: true,
      };
    }
    throw err;
  }
  const registrations = Array.isArray(response?.data?.completeDataSetRegistrations)
    ? response.data.completeDataSetRegistrations
    : Array.isArray(response?.data?.completeDataSets)
      ? response.data.completeDataSets
      : Array.isArray(response?.data?.registrations)
        ? response.data.registrations
        : [];

  const match = registrations.find((item) => {
    const dataSet = String(item?.dataSet || item?.ds || '').trim();
    const period = String(item?.period || item?.pe || '').trim();
    const orgUnit = String(item?.organisationUnit || item?.orgUnit || item?.ou || '').trim();
    const aoc = String(item?.attributeOptionCombo || item?.aoc || '').trim();

    const scopeAoc = String(scope?.attributeOptionCombo || '').trim();
    return dataSet === String(scope?.dataSet || '').trim()
      && period === String(scope?.period || '').trim()
      && orgUnit === String(scope?.orgUnit || '').trim()
      && (scopeAoc ? aoc === scopeAoc : true);
  }) || null;

  return {
    scope,
    isCompleted: Boolean(match),
    registration: match ? normalizeCompletionRegistration(match, scope) : null,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = {
  runDataSetValidation,
  registerDataSetCompletion,
  unregisterDataSetCompletion,
  getDataSetCompletionStatus,
};
