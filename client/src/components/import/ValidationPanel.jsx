import React, { useMemo, useState } from 'react'
import { Alert, Card, Form, Select, Switch, Typography, Space, Tag, List, Table, Input, Button, Drawer, Descriptions } from 'antd'
import { CheckCircleOutlined, WarningOutlined, CloseCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

function asArray(value) {
  if (Array.isArray(value)) return value
  if (value === null || value === undefined || value === '') return []
  return [value]
}

function asText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function normalizeIssue(issue, fallbackSeverity = 'error') {
  if (typeof issue === 'string') {
    return {
      severity: fallbackSeverity,
      message: issue,
      raw: issue,
      row: '',
      field: '',
      column: '',
      dataElement: '',
      dataElementName: '',
      orgUnitId: '',
      orgUnitName: '',
      orgUnit: '',
      period: '',
      value: '',
    }
  }

  const obj = issue && typeof issue === 'object' ? issue : {}
  return {
    severity: obj.severity || fallbackSeverity,
    message: obj.message || asText(issue),
    raw: obj.raw || '',
    row: obj.row ?? '',
    field: obj.field || '',
    column: obj.column || '',
    dataElement: obj.dataElement || '',
    dataElementName: obj.dataElementName || '',
    orgUnitId: obj.orgUnitId || '',
    orgUnitName: obj.orgUnitName || '',
    orgUnit: obj.orgUnit || '',
    period: obj.period || '',
    value: obj.value ?? '',
    program: obj.program || '',
    programStage: obj.programStage || '',
    trackedEntityType: obj.trackedEntityType || '',
  }
}

function resolveDataElementDisplay(issue = {}) {
  const name = String(issue.dataElementName || '').trim()
  const id = String(issue.dataElement || '').trim()
  if (name && id) return `${name} (${id})`
  return name || id || ''
}

function resolveOrgUnitDisplay(issue = {}) {
  const name = String(issue.orgUnitName || issue.orgUnit || '').trim()
  const id = String(issue.orgUnitId || '').trim()
  if (name && id) return `${name} (${id})`
  return name || id || ''
}

const STRATEGIES = [
  { value: 'CREATE', label: 'CREATE – only create new records' },
  { value: 'UPDATE', label: 'UPDATE – only update existing records' },
  { value: 'CREATE_AND_UPDATE', label: 'CREATE_AND_UPDATE (recommended)' },
  { value: 'DELETE', label: 'DELETE – remove records' },
]

const ATOMIC_MODES = [
  { value: 'ALL', label: 'ALL – all or nothing' },
  { value: 'OBJECT', label: 'OBJECT – continue on individual errors' },
]

export default function ValidationPanel({ result, options, onOptionsChange, onMarkCompleteTouched, dataType, simpleMode = false }) {
  const errors = asArray(result?.errors)
  const warnings = asArray(result?.warnings)
  const rowErrors = asArray(result?.rowIssues?.errors).map((issue) => normalizeIssue(issue, 'error'))
  const rowWarnings = asArray(result?.rowIssues?.warnings).map((issue) => normalizeIssue(issue, 'warning'))
  const normalizedErrors = errors.map((issue) => normalizeIssue(issue, 'error'))
  const normalizedWarnings = warnings.map((issue) => normalizeIssue(issue, 'warning'))
  const issueRows = [...rowErrors, ...rowWarnings]
  const blockingErrorCount = normalizedErrors.length + rowErrors.length
  const hasBlockingIssues = !result?.valid || blockingErrorCount > 0
  const hasDataElementIssue = useMemo(() => {
    const all = [...normalizedErrors, ...issueRows]
    return all.some((issue) => Boolean(resolveDataElementDisplay(issue)))
  }, [normalizedErrors, issueRows])
  const isAggregate = dataType === 'aggregate'
  const aggregateValidation = result?.aggregateValidation
  const aggregateViolations = asArray(aggregateValidation?.violations)
  const completionAllowed = result?.completionPolicy?.completionAllowed !== false
  const [selectedIssue, setSelectedIssue] = useState(null)
  const templateCompletionIntent = result?.templateCompletionIntent || null
  const templateMismatch = result?.templateMismatch || null

  const issueColumns = useMemo(() => {
    const columns = [
      { title: 'Severity', dataIndex: 'severity', key: 'severity', width: 90 },
      { title: 'Row', dataIndex: 'row', key: 'row', width: 80 },
      { title: 'Column', dataIndex: 'column', key: 'column', width: 140 },
      { title: 'Field', dataIndex: 'field', key: 'field', width: 140 },
    ]

    if (hasDataElementIssue) {
      columns.push({
        title: 'Data Element',
        key: 'dataElementDisplay',
        width: 220,
        render: (_, row) => resolveDataElementDisplay(row),
      })
    }

    columns.push(
      {
        title: 'Org Unit',
        key: 'orgUnitDisplay',
        width: 220,
        render: (_, row) => resolveOrgUnitDisplay(row),
      },
      { title: 'Period', dataIndex: 'period', key: 'period', width: 110 },
      { title: 'Value', dataIndex: 'value', key: 'value', width: 120 },
      { title: 'Message', dataIndex: 'message', key: 'message' },
      {
        title: 'Details',
        key: 'details',
        width: 90,
        fixed: 'right',
        render: (_, row) => (
          <Button size="small" onClick={() => setSelectedIssue(row)}>Details</Button>
        ),
      },
    )

    return columns
  }, [hasDataElementIssue])

  const downloadIssueReport = () => {
    if (issueRows.length === 0) return
    const header = ['severity', 'row', 'column', 'field', 'dataElementName', 'dataElement', 'orgUnitName', 'orgUnitId', 'period', 'value', 'program', 'programStage', 'trackedEntityType', 'message']
    const lines = issueRows.map((issue) => [
      issue.severity,
      issue.row,
      issue.column || '',
      issue.field || '',
      issue.dataElementName || '',
      issue.dataElement || '',
      issue.orgUnitName || issue.orgUnit || '',
      issue.orgUnitId || '',
      issue.period || '',
      issue.value ?? '',
      issue.program || '',
      issue.programStage || '',
      issue.trackedEntityType || '',
      String(issue.message || '').replace(/"/g, '""'),
    ].map((cell) => `"${cell}"`).join(','))
    const csv = [header.join(','), ...lines].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'import-validation-issues.csv'
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div>
      {result && (
        <div style={{ marginBottom: 16 }}>
          {templateMismatch?.code && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 8 }}
              message={
                templateMismatch.code === 'DATASET_MISMATCH'
                  ? 'Template / Dataset Mismatch'
                  : templateMismatch.code === 'PROGRAM_MISMATCH'
                    ? 'Template / Program Mismatch'
                    : templateMismatch.code === 'PROGRAM_STAGE_MISMATCH'
                      ? 'Template / Program Stage Mismatch'
                      : 'Template Identity Mismatch'
              }
              description={
                <div>
                  {(templateMismatch.uploadedDatasetId || templateMismatch.uploadedDatasetName) && (
                    <div>
                      <strong>This file belongs to dataset:</strong>{' '}
                      {templateMismatch.uploadedDatasetName
                        ? `${templateMismatch.uploadedDatasetName} (${templateMismatch.uploadedDatasetId})`
                        : templateMismatch.uploadedDatasetId}
                    </div>
                  )}
                  {(templateMismatch.uploadedProgramId || templateMismatch.uploadedProgramName) && (
                    <div>
                      <strong>This file belongs to program:</strong>{' '}
                      {templateMismatch.uploadedProgramName
                        ? `${templateMismatch.uploadedProgramName} (${templateMismatch.uploadedProgramId})`
                        : templateMismatch.uploadedProgramId}
                    </div>
                  )}
                  {templateMismatch.selectedDatasetId && (
                    <div><strong>You selected dataset:</strong> {templateMismatch.selectedDatasetId}</div>
                  )}
                  {templateMismatch.selectedProgramId && (
                    <div><strong>You selected program:</strong> {templateMismatch.selectedProgramId}</div>
                  )}
                  <div style={{ marginTop: 6 }}>
                    Download the correct template for your selected dataset/program, or select the matching dataset/program before running Dry Run.
                  </div>
                  {(templateMismatch.mismatchWarnings || []).map((w, i) => (
                    <div key={i} style={{ marginTop: 4, color: '#d46b08' }}>
                      ⚠ {w.message}
                    </div>
                  ))}
                </div>
              }
            />
          )}

          {isAggregate && templateCompletionIntent?.status && templateCompletionIntent.status !== 'ok' && (
            <Alert
              type="error"
              showIcon
              style={{ marginBottom: 8 }}
              message="Submission Decision in Excel needs attention"
              description={templateCompletionIntent.status === 'missing'
                ? 'Start Here > Submission Decision is blank. Choose Draft or Submit and Mark Complete, save, then run Dry Run again.'
                : `Start Here > Submission Decision value "${templateCompletionIntent.raw || ''}" is invalid. Use Draft or Submit and Mark Complete.`}
            />
          )}

          {result.valid ? (
            <Alert
              type="success"
              icon={<CheckCircleOutlined />}
              message={`Validation passed — ready to import`}
              description={
                <Space>
                  <Tag color="blue">{result.counts?.events || 0} events</Tag>
                  <Tag color="purple">{result.counts?.enrollments || 0} enrollments</Tag>
                  <Tag color="cyan">{result.counts?.trackedEntities || 0} tracked entities</Tag>
                  <Tag color="gold">{result.counts?.aggregate || 0} aggregate values</Tag>
                </Space>
              }
              showIcon
            />
          ) : (
            <Alert
              type="error"
              icon={<CloseCircleOutlined />}
              message={`Validation failed — ${blockingErrorCount} blocking error(s)`}
              description={
                normalizedErrors.length > 0 ? (
                  <Table
                    size="small"
                    rowKey={(row, i) => `error-${row.row}-${row.field}-${i}`}
                    dataSource={normalizedErrors}
                    pagination={{ pageSize: 20 }}
                    columns={[
                      { title: 'Row', dataIndex: 'row', key: 'row', width: 70 },
                      { title: 'Field', dataIndex: 'field', key: 'field', width: 130 },
                      ...(hasDataElementIssue
                        ? [{
                          title: 'Data Element',
                          key: 'dataElementDisplay',
                          width: 220,
                          render: (_, row) => resolveDataElementDisplay(row),
                        }]
                        : []),
                      {
                        title: 'Org Unit',
                        key: 'orgUnitDisplay',
                        width: 220,
                        render: (_, row) => resolveOrgUnitDisplay(row),
                      },
                      { title: 'Period', dataIndex: 'period', key: 'period', width: 110 },
                      { title: 'Message', dataIndex: 'message', key: 'message' },
                    ]}
                    scroll={{ x: 900 }}
                  />
                ) : 'Validation contains blocking issues. Check row-level issues below for details.'
              }
              showIcon
            />
          )}

          {normalizedWarnings.length > 0 && (
            <Alert
              type="warning"
              icon={<WarningOutlined />}
              message={`${normalizedWarnings.length} warning(s)`}
              description={
                <List
                  size="small"
                  dataSource={normalizedWarnings}
                  renderItem={(w) => <List.Item><Text type="warning" style={{ fontSize: 12 }}>{w.message}</Text></List.Item>}
                />
              }
              showIcon
              style={{ marginTop: 8 }}
            />
          )}

          {issueRows.length > 0 && (
            <Card
              size="small"
              title={`Row-level issues (${issueRows.length})`}
              extra={<Button size="small" onClick={downloadIssueReport}>Download CSV</Button>}
              style={{ marginTop: 12 }}
            >
              <Table
                size="small"
                rowKey={(row, i) => `${row.severity}-${row.row}-${row.field}-${i}`}
                dataSource={issueRows}
                columns={issueColumns}
                pagination={{ pageSize: 25 }}
                scroll={{ y: 360, x: 1320 }}
              />
            </Card>
          )}
        </div>
      )}

      {isAggregate && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Aggregate import uses DHIS2 data value sets"
            description="Tracker import options do not apply here. Aggregate imports are submitted synchronously using the dataValueSets API."
          />

          <Card size="small" title="Dataset Validation (DHIS2)">
            <Space direction="vertical" style={{ width: '100%' }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Scope: ds={aggregateValidation?.scope?.dataSet || '—'}, pe={aggregateValidation?.scope?.period || '—'}, ou={aggregateValidation?.scope?.orgUnit || '—'}
              </Text>

              {!completionAllowed ? (
                <Alert
                  type="error"
                  showIcon
                  message="Completion policy blocked"
                  description="Mark complete is blocked until dataset validation has zero violations."
                />
              ) : hasBlockingIssues ? (
                <Alert
                  type="warning"
                  showIcon
                  message="Dataset completion check passed, but other import errors exist"
                  description="The dataset validation itself passed, but dry run still found blocking issues. Fix those issues before importing."
                />
              ) : (
                <Alert
                  type="success"
                  showIcon
                  message="Completion policy check passed"
                  description="No dataset validation violations were found. Mark complete is allowed."
                />
              )}

              {aggregateViolations.length > 0 && (
                <Table
                  size="small"
                  rowKey={(row, i) => `${row.id || row.rule || 'v'}-${i}`}
                  dataSource={aggregateViolations}
                  pagination={false}
                  columns={[
                    { title: 'Rule', dataIndex: 'rule', key: 'rule', width: 260 },
                    { title: 'Operator', dataIndex: 'operator', key: 'operator', width: 110 },
                    { title: 'Left', dataIndex: 'leftValue', key: 'leftValue', width: 120 },
                    { title: 'Right', dataIndex: 'rightValue', key: 'rightValue', width: 120 },
                    { title: 'Message', dataIndex: 'message', key: 'message' },
                  ]}
                  scroll={{ y: 220 }}
                />
              )}
            </Space>
          </Card>
        </>
      )}

      <Card size="small" title="Import Options">
        <Form layout="vertical" size="small">
          {!isAggregate && !simpleMode && (
            <>
              <Form.Item label="Import Strategy">
                <Select
                  options={STRATEGIES}
                  value={options.importStrategy}
                  onChange={(v) => onOptionsChange({ ...options, importStrategy: v })}
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item label="Atomic Mode">
                <Select
                  options={ATOMIC_MODES}
                  value={options.atomicMode}
                  onChange={(v) => onOptionsChange({ ...options, atomicMode: v })}
                  style={{ width: '100%' }}
                />
              </Form.Item>

              <Form.Item label="Async Import" style={{ marginBottom: 0 }}>
                <Switch
                  checked={options.async}
                  onChange={(v) => onOptionsChange({ ...options, async: v })}
                  checkedChildren="Async"
                  unCheckedChildren="Sync"
                />
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  Use async for large datasets (&gt;500 records)
                </Text>
              </Form.Item>
            </>
          )}

          {!isAggregate && simpleMode && (
            <Alert
              type="info"
              showIcon
              message="Simple mode uses safe defaults"
              description="Import strategy: CREATE_AND_UPDATE, atomic mode: ALL, execution: synchronous."
            />
          )}

          {isAggregate && (
            <>
              <Form.Item label="Submission Decision" style={{ marginBottom: 8 }}>
                <Select
                  value={options.markComplete ? 'submit' : 'draft'}
                  onChange={(v) => {
                    onMarkCompleteTouched?.()
                    onOptionsChange({ ...options, markComplete: v === 'submit' })
                  }}
                  options={[
                    { value: 'draft', label: 'Draft' },
                    { value: 'submit', label: 'Submit and Mark Complete' },
                  ]}
                />
                <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
                  This setting applies to the full dataset submission.
                </Text>
              </Form.Item>

              <Form.Item label="Submission comment" style={{ marginBottom: 8 }}>
                <Input.TextArea
                  placeholder="Optional comment for this dataset submission"
                  rows={2}
                  value={options.submissionComment || ''}
                  onChange={(e) => onOptionsChange({ ...options, submissionComment: e.target.value })}
                />
              </Form.Item>
            </>
          )}
        </Form>
      </Card>

      <Drawer
        title="Issue Details"
        placement="right"
        width={560}
        onClose={() => setSelectedIssue(null)}
        open={Boolean(selectedIssue)}
      >
        {selectedIssue && (
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="Severity">{selectedIssue.severity || '—'}</Descriptions.Item>
            <Descriptions.Item label="Row">{selectedIssue.row || '—'}</Descriptions.Item>
            <Descriptions.Item label="Column">{selectedIssue.column || '—'}</Descriptions.Item>
            <Descriptions.Item label="Field">{selectedIssue.field || '—'}</Descriptions.Item>
            <Descriptions.Item label="Message">{selectedIssue.message || '—'}</Descriptions.Item>
            <Descriptions.Item label="Data Element">{resolveDataElementDisplay(selectedIssue) || '—'}</Descriptions.Item>
            <Descriptions.Item label="Data Element ID">{selectedIssue.dataElement || '—'}</Descriptions.Item>
            <Descriptions.Item label="Org Unit">{resolveOrgUnitDisplay(selectedIssue) || '—'}</Descriptions.Item>
            <Descriptions.Item label="Org Unit ID">{selectedIssue.orgUnitId || '—'}</Descriptions.Item>
            <Descriptions.Item label="Period">{selectedIssue.period || '—'}</Descriptions.Item>
            <Descriptions.Item label="Value">{asText(selectedIssue.value) || '—'}</Descriptions.Item>
            <Descriptions.Item label="Program">{selectedIssue.program || '—'}</Descriptions.Item>
            <Descriptions.Item label="Program Stage">{selectedIssue.programStage || '—'}</Descriptions.Item>
            <Descriptions.Item label="Tracked Entity Type">{selectedIssue.trackedEntityType || '—'}</Descriptions.Item>
            <Descriptions.Item label="Raw">{selectedIssue.raw || '—'}</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </div>
  )
}
