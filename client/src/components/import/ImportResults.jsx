import React from 'react'
import { Alert, Card, Row, Col, Statistic, List, Typography, Tag, Table, Space } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined, WarningOutlined } from '@ant-design/icons'

const { Text } = Typography

function stringifyIssue(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    return value.message || value.description || value.errorMessage || JSON.stringify(value)
  }
  return String(value)
}

function buildImportReportRows(importReport) {
  const errors = Array.isArray(importReport?.errors) ? importReport.errors : []
  const warnings = Array.isArray(importReport?.warnings) ? importReport.warnings : []

  const errorRows = errors.map((item, index) => ({
    key: `error-${index}`,
    severity: 'error',
    message: stringifyIssue(item),
  }))
  const warningRows = warnings.map((item, index) => ({
    key: `warning-${index}`,
    severity: 'warning',
    message: stringifyIssue(item),
  }))

  return [...errorRows, ...warningRows]
}

function ImportReportDetails({ importReport }) {
  if (!importReport) return null

  const rows = buildImportReportRows(importReport)
  const stats = importReport?.stats || {}

  return (
    <Card
      size="small"
      title="Tracker Import Report"
      style={{ marginTop: 12 }}
      extra={(
        <Space>
          {importReport?.status ? <Tag>{importReport.status}</Tag> : null}
          <Tag color={importReport?.hasBlockingErrors ? 'red' : 'green'}>
            {importReport?.hasBlockingErrors ? 'Blocking Errors' : 'No Blocking Errors'}
          </Tag>
        </Space>
      )}
    >
      <Row gutter={12} style={{ marginBottom: 12 }}>
        <Col span={6}><Text type="secondary">Created: {stats.created || 0}</Text></Col>
        <Col span={6}><Text type="secondary">Updated: {stats.updated || 0}</Text></Col>
        <Col span={6}><Text type="secondary">Ignored: {stats.ignored || 0}</Text></Col>
        <Col span={6}><Text type="secondary">Failed: {stats.failed || 0}</Text></Col>
      </Row>

      {rows.length > 0 ? (
        <Table
          size="small"
          dataSource={rows.slice(0, 200)}
          pagination={false}
          rowKey="key"
          columns={[
            {
              title: 'Severity',
              dataIndex: 'severity',
              key: 'severity',
              width: 120,
              render: (value) => (
                <Tag color={value === 'error' ? 'red' : 'gold'}>
                  {value.toUpperCase()}
                </Tag>
              ),
            },
            {
              title: 'Message',
              dataIndex: 'message',
              key: 'message',
              render: (value) => <Text style={{ fontSize: 12 }}>{value}</Text>,
            },
          ]}
          scroll={{ y: 260 }}
        />
      ) : (
        <Text type="secondary">No import report messages were returned.</Text>
      )}
    </Card>
  )
}

function ValidationViolationsPanel({ violations = [], violationCount = 0 }) {
  if (!violations.length && !violationCount) return null

  const displayViolations = violations.slice(0, 50)

  return (
    <Card
      size="small"
      title={
        <Text type="danger">
          <WarningOutlined style={{ marginRight: 6 }} />
          DHIS2 Validation Violations ({violationCount || violations.length})
        </Text>
      }
      style={{ marginBottom: 12, borderColor: '#ff4d4f' }}
    >
      {displayViolations.length > 0 ? (
        <List
          size="small"
          dataSource={displayViolations}
          renderItem={(v, i) => (
            <List.Item key={i}>
              <Space direction="vertical" size={0} style={{ width: '100%' }}>
                <Text type="danger" style={{ fontSize: 12 }}>
                  {v.rule || v.name || `Violation ${i + 1}`}
                </Text>
                {v.message && <Text style={{ fontSize: 11 }} type="secondary">{v.message}</Text>}
              </Space>
            </List.Item>
          )}
        />
      ) : (
        <Text type="secondary">{violationCount} violation(s) found. Fix data values and retry.</Text>
      )}
      {violations.length > 50 && (
        <Text type="secondary" style={{ fontSize: 12 }}>... and {violations.length - 50} more violations</Text>
      )}
    </Card>
  )
}

function normalizeCompletionStatus(rawStatus) {
  const status = String(rawStatus || '').trim().toLowerCase()
  if (status === 'registered') return 'completed_successfully'
  if (status === 'blocked') return 'blocked'
  return status
}

function CompletionStatusPanel({ completion, completionStatus, completionRequested }) {
  if (!completion && !completionStatus) return null

  const status = completionStatus || normalizeCompletionStatus(completion?.status)

  if (status === 'not_requested') return null

  if (status === 'completed') {
    return (
      <Alert
        type="success"
        showIcon
        message="Dataset Completion Status: Completed Successfully"
        style={{ marginBottom: 12 }}
      />
    )
  }

  // Handle blocked completions with specific reason messages
  if (status === 'blocked') {
    const reason = completion?.reason
    if (reason === 'validation-violations') {
      const count = completion?.violationCount || 0
      return (
        <Alert
          type="error"
          showIcon
          message="Dataset Completion Blocked: Validation Violations"
          description={`${count} DHIS2 validation violation(s) were found after import. Fix data values and re-import to mark complete.`}
          style={{ marginBottom: 12 }}
        />
      )
    }
    if (reason === 'validation-unavailable') {
      return (
        <Alert
          type="warning"
          showIcon
          message="Dataset Completion Blocked: Validation Unavailable"
          description="DHIS2 dataset validation endpoint is unavailable. Completion is blocked by default for safety. Contact your system administrator."
          style={{ marginBottom: 12 }}
        />
      )
    }
    return (
      <Alert
        type="warning"
        showIcon
        message="Dataset Completion Status: Blocked"
        description={`Completion was blocked. Reason: ${reason || 'unknown'}. Review errors before marking complete.`}
        style={{ marginBottom: 12 }}
      />
    )
  }

  if (status === 'completed_successfully') {
    return (
      <Alert
        type="success"
        showIcon
        message="Dataset Completion Status: Completed Successfully"
        style={{ marginBottom: 12 }}
      />
    )
  }

  if (status === 'already_completed') {
    const completedOn = completion?.precheck?.registration?.completedOn
      || completion?.alreadyCompleted?.[0]?.precheck?.registration?.completedOn
      || null
    const count = completion?.summary?.alreadyCompletedCount
    return (
      <Alert
        type="warning"
        showIcon
        message="Dataset Completion Status: Already Completed"
        description={completedOn
          ? `Completed On: ${completedOn}${count ? ` | Scopes already completed: ${count}` : ''}`
          : (count ? `${count} scope(s) were already marked complete.` : 'This dataset has already been marked complete.')}
        style={{ marginBottom: 12 }}
      />
    )
  }

  if (status === 'completion_failed' || status === 'failed') {
    const failedCount = completion?.summary?.failedCount || completion?.failed?.length || 0
    const errorText = typeof completion?.error === 'string'
      ? completion.error
      : completion?.failed?.[0]?.error
        ? JSON.stringify(completion.failed[0].error)
        : JSON.stringify(completion?.error || {})
    return (
      <Alert
        type="error"
        showIcon
        message="Dataset Completion Status: Completion Failed"
        description={`Reason: ${errorText}${failedCount ? ` | Failed scopes: ${failedCount}` : ''}`}
        style={{ marginBottom: 12 }}
      />
    )
  }

  if (completionRequested && status === 'not_completed') {
    return (
      <Alert
        type="info"
        showIcon
        message="Dataset Completion Status: Not Completed"
        description="Completion was requested but not attempted due to import or validation issues."
        style={{ marginBottom: 12 }}
      />
    )
  }

  return null
}

export default function ImportResults({ result, error }) {
  const importReport = result?.importReport || result?.result?.importReport || error?.importReport || error?.result?.importReport || null

  if (error) {
    return (
      <div>
        <Alert
          type="error"
          message={error?.message || 'Import failed'}
          description={(
            <div>
              <div>{error?.hint || 'Review your file and options, then retry.'}</div>
              {error?.status ? <Text type="secondary">Status: {error.status}</Text> : null}
            </div>
          )}
          showIcon
        />
        <ImportReportDetails importReport={importReport} />
      </div>
    )
  }

  if (!result) return null

  if (result?.expired || result?.status === 'EXPIRED') {
    return (
      <Alert
        type="warning"
        message="Import job status expired"
        description={result?.message || 'This async import job is older than the configured retention TTL.'}
        showIcon
      />
    )
  }

  if (result?.jobId && String(result?.status || '').toUpperCase() !== 'COMPLETED') {
    return (
      <Alert
        type="info"
        message="Async import accepted"
        description={`Job ${result.jobId} is ${String(result.status || 'PENDING').toLowerCase()}. Check the History page to monitor progress and retention state.`}
        showIcon
      />
    )
  }

  const stats = result?.result?.stats || result?.stats || {}
  const importSummary = result?.result?.importSummary || {}
  const importCount = importSummary.importCount || stats
  const conflicts = result?.result?.conflicts || importSummary.conflicts || []
  const completion = result?.completion || result?.completionResult || null
  const completionStatus = result?.completionStatus || null
  const completionRequested = result?.completionRequested || false
  const validationViolations = Array.isArray(result?.validationViolations) ? result.validationViolations : []
  const nextAction = result?.nextAction || null
  const canMarkComplete = result?.canMarkComplete

  const imported = importCount?.imported || importCount?.created || stats?.imported || stats?.created || 0
  const updated = importCount?.updated || stats?.updated || 0
  const ignored = importCount?.ignored || stats?.ignored || 0
  const deleted = importCount?.deleted || stats?.deleted || 0

  // Determine overall success using structured fields when available
  const importStatus = result?.importStatus || null
  const hasErrors = conflicts.length > 0 || importStatus === 'failed'
  const completionBlocked = completionStatus === 'blocked'
  const showFullSuccess = !hasErrors && (completionStatus === 'completed' || completionStatus === 'not_requested' || !completionRequested)

  return (
    <div>
      <Alert
        type={hasErrors ? 'error' : (completionBlocked ? 'warning' : 'success')}
        icon={hasErrors ? <CloseCircleOutlined /> : (completionBlocked ? <WarningOutlined /> : <CheckCircleOutlined />)}
        message={
          hasErrors
            ? 'Import Failed'
            : completionBlocked
              ? 'Import Succeeded — Completion Blocked'
              : showFullSuccess
                ? (completionRequested ? 'Import and Completion Successful' : 'Data Imported Successfully')
                : 'Data Import Completed with Warnings'
        }
        description={nextAction || undefined}
        showIcon
        style={{ marginBottom: 16 }}
      />

      <CompletionStatusPanel
        completion={completion}
        completionStatus={completionStatus}
        completionRequested={completionRequested}
      />

      {validationViolations.length > 0 && (
        <ValidationViolationsPanel
          violations={validationViolations}
          violationCount={completion?.violationCount || validationViolations.length}
        />
      )}

      <ImportReportDetails importReport={importReport} />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="Data Values Imported" value={imported} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Data Values Updated" value={updated} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Data Values Ignored" value={ignored} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Deleted" value={deleted} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
      </Row>

      {conflicts.length > 0 && (
        <Card size="small" title={<Text type="danger">Errors / Conflicts ({conflicts.length})</Text>}>
          <List
            size="small"
            dataSource={conflicts.slice(0, 50)}
            renderItem={(conflict, i) => (
              <List.Item key={i}>
                <Text type="danger" style={{ fontSize: 12 }}>
                  {typeof conflict === 'string' ? conflict : JSON.stringify(conflict)}
                </Text>
              </List.Item>
            )}
          />
          {conflicts.length > 50 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              ... and {conflicts.length - 50} more errors
            </Text>
          )}
        </Card>
      )}
    </div>
  )
}
