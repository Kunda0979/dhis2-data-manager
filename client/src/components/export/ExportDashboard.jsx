import React, { useState, useEffect } from 'react'
import { Card, Steps, Button, Space, Divider, App, Progress, Alert, Typography, Form, Input, Select } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import ProgramSelector from './ProgramSelector.jsx'
import OrgUnitSelector from './OrgUnitSelector.jsx'
import DateRangeFilter from './DateRangeFilter.jsx'
import ExportOptions from './ExportOptions.jsx'
import ExportResults from './ExportResults.jsx'
import { useDhis2Export } from '../../hooks/useDhis2Export.js'
import { useDhis2Metadata } from '../../hooks/useDhis2Metadata.js'
import { normalizeApiError, toUserErrorText } from '../../utils/apiError.js'

const EXPORT_PREFS_KEY = 'dhis2_export_prefs'
const SETTINGS_KEY = 'dhis2_settings'

function loadExportPrefs() {
  let defaultFormat = 'json'
  try {
    const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    if (settings?.defaultFormat) defaultFormat = settings.defaultFormat
  } catch {
    defaultFormat = 'json'
  }

  try {
    const parsed = JSON.parse(localStorage.getItem(EXPORT_PREFS_KEY) || '{}')
    return {
      dataType: parsed.dataType || 'events',
      format: parsed.format || defaultFormat,
      asyncMode: Boolean(parsed.asyncMode),
      ouMode: parsed.ouMode || 'DESCENDANTS',
      status: parsed.status,
    }
  } catch {
    return {
      dataType: 'events',
      format: defaultFormat,
      asyncMode: false,
      ouMode: 'DESCENDANTS',
      status: undefined,
    }
  }
}

export default function ExportDashboard() {
  const savedPrefs = loadExportPrefs()
  const { message } = App.useApp()
  const [currentStep, setCurrentStep] = useState(0)
  const [filters, setFilters] = useState({
    program: undefined,
    dataSet: undefined,
    period: undefined,
    orgUnit: undefined,
    ouMode: savedPrefs.ouMode,
    startDate: undefined,
    endDate: undefined,
    status: savedPrefs.status,
  })
  const [dataType, setDataType] = useState(savedPrefs.dataType)
  const [format, setFormat] = useState(savedPrefs.format)
  const [asyncMode, setAsyncMode] = useState(savedPrefs.asyncMode)
  const [activeJobId, setActiveJobId] = useState(null)

  const {
    exportData,
    downloadFile,
    data,
    loading,
    error,
    count,
    jobStatus,
    startExportJob,
    getExportJob,
    cancelExportJob,
    downloadExportJob,
  } = useDhis2Export()
  const {
    programs,
    dataSets,
    fetchPrograms,
    fetchDataSets,
    fetchOrgUnits,
    fetchOrgUnitsByIds,
  } = useDhis2Metadata()

  const isAggregate = dataType === 'aggregate'

  useEffect(() => {
    fetchPrograms()
    fetchDataSets()
  }, [])

  const handleRefreshMetadata = async () => {
    await Promise.all([
      fetchPrograms({ refresh: true }),
      fetchDataSets({ refresh: true }),
    ])
    message.success('Metadata refreshed')
  }

  useEffect(() => {
    localStorage.setItem(EXPORT_PREFS_KEY, JSON.stringify({
      dataType,
      format,
      asyncMode,
      ouMode: filters.ouMode,
      status: filters.status,
    }))
  }, [asyncMode, dataType, filters.ouMode, filters.status, format])

  const hasValidDateRange = !filters.startDate || !filters.endDate || filters.startDate <= filters.endDate
  const hasAggregateRequirements = Boolean(filters.dataSet) && Boolean(filters.period) && Boolean(filters.orgUnit)
  const canFetch = isAggregate ? hasAggregateRequirements : (Boolean(filters.orgUnit) && hasValidDateRange)

  useEffect(() => {
    if (!isAggregate && filters.period === undefined && filters.dataSet === undefined) {
      return
    }
    if (isAggregate) {
      setFilters((current) => ({ ...current, status: undefined }))
    }
  }, [isAggregate])

  const readinessItems = [
    { done: Boolean(filters.orgUnit), label: 'Organisation unit selected' },
    { done: isAggregate ? Boolean(filters.dataSet) : hasValidDateRange, label: isAggregate ? 'Dataset selected' : 'Date range is valid' },
    { done: isAggregate ? Boolean(filters.period) : true, label: isAggregate ? 'Period entered' : 'Tracker filters ready' },
    { done: Boolean(dataType), label: 'Data type selected' },
    { done: Boolean(format), label: 'Export format selected' },
  ]

  const handleExport = async () => {
    if (!filters.orgUnit) {
      message.warning('Please select an organisation unit')
      return
    }
    if (!isAggregate && !hasValidDateRange) {
      message.warning('Please use a valid date range (start date must be before end date)')
      return
    }
    if (isAggregate && !filters.dataSet) {
      message.warning('Please select a dataset for aggregate export')
      return
    }
    if (isAggregate && !filters.period) {
      message.warning('Please enter a DHIS2 period for aggregate export')
      return
    }
    const params = {}
    if (isAggregate) {
      params.dataSet = filters.dataSet
      params.period = filters.period
      params.children = filters.ouMode === 'CHILDREN' || filters.ouMode === 'DESCENDANTS' ? 'true' : undefined
    } else if (filters.program) {
      params.program = filters.program
    }
    if (filters.orgUnit) params.orgUnit = filters.orgUnit
    if (!isAggregate && filters.ouMode) params.ouMode = filters.ouMode
    if (!isAggregate && filters.startDate) params.startDate = filters.startDate
    if (!isAggregate && filters.endDate) params.endDate = filters.endDate
    if (!isAggregate && filters.status) params.status = filters.status

    if (asyncMode) {
      const job = await startExportJob(dataType, params, format)
      if (job?.jobId) {
        setActiveJobId(job.jobId)
      }
    } else {
      await exportData(dataType, params)
    }
    setCurrentStep(1)
  }

  const handleDownload = async () => {
    if (!filters.orgUnit) return
    const params = {}
    if (isAggregate) {
      params.dataSet = filters.dataSet
      params.period = filters.period
      params.children = filters.ouMode === 'CHILDREN' || filters.ouMode === 'DESCENDANTS' ? 'true' : undefined
    } else if (filters.program) {
      params.program = filters.program
    }
    if (filters.orgUnit) params.orgUnit = filters.orgUnit
    if (!isAggregate && filters.ouMode) params.ouMode = filters.ouMode
    if (!isAggregate && filters.startDate) params.startDate = filters.startDate
    if (!isAggregate && filters.endDate) params.endDate = filters.endDate

    try {
      if (asyncMode && activeJobId) {
        await downloadExportJob(activeJobId)
        message.success('Downloaded async export result')
      } else {
        await downloadFile(dataType, params, format)
        message.success(`Downloaded ${count} records as ${format.toUpperCase()}`)
      }
    } catch (err) {
      message.error(toUserErrorText(normalizeApiError(err)))
    }
  }

  useEffect(() => {
    if (!activeJobId) return undefined

    const timer = setInterval(async () => {
      const status = await getExportJob(activeJobId)
      if (status?.status === 'completed') {
        setCurrentStep(1)
        if (format === 'json') {
          await exportData(dataType, {
            ...filters,
          })
        }
        clearInterval(timer)
      }
      if (status?.status === 'failed' || status?.status === 'cancelled' || status?.outputExpired) {
        clearInterval(timer)
      }
    }, 2000)

    return () => clearInterval(timer)
  }, [activeJobId, dataType, exportData, filters, format, getExportJob])

  const steps = [
    { title: 'Configure', description: 'Set filters' },
    { title: 'Review', description: 'Preview data' },
    { title: 'Download', description: 'Export file' },
  ]
  const readyToDownload = asyncMode ? (jobStatus?.status === 'completed' && !jobStatus?.outputExpired) : data.length > 0

  return (
    <div>
      <Card>
        <Steps current={currentStep === 0 ? 0 : (readyToDownload ? 2 : 1)} items={steps} style={{ marginBottom: 24 }} size="small" />

        {currentStep === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Space style={{ marginBottom: 12 }}>
                <Button size="small" onClick={handleRefreshMetadata}>Refresh metadata</Button>
              </Space>
              {isAggregate ? (
                <>
                  <Form.Item label="Dataset" style={{ marginBottom: 12 }} required>
                    <Select
                      showSearch
                      allowClear
                      placeholder="Select a dataset"
                      options={dataSets.map((dataSet) => ({
                        value: dataSet.id,
                        label: `${dataSet.displayName} (${dataSet.periodType || 'Period'})`,
                      }))}
                      value={filters.dataSet}
                      onChange={(value) => setFilters((f) => ({ ...f, dataSet: value }))}
                      filterOption={(input, option) => option?.label?.toLowerCase().includes(input.toLowerCase())}
                    />
                  </Form.Item>
                  <Form.Item label="Period" style={{ marginBottom: 12 }} required>
                    <Input
                      placeholder="e.g. 202604, 2026Q1, 2026"
                      value={filters.period}
                      onChange={(e) => setFilters((f) => ({ ...f, period: e.target.value || undefined }))}
                    />
                  </Form.Item>
                  <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Aggregate export uses DHIS2 periods"
                    description="Use a valid DHIS2 period such as YYYY, YYYYMM, YYYYQn, or YYYYWn."
                  />
                </>
              ) : (
                <ProgramSelector
                  programs={programs}
                  value={filters.program}
                  onChange={(v) => setFilters((f) => ({ ...f, program: v }))}
                />
              )}
              <OrgUnitSelector
                value={filters.orgUnit}
                onChange={(v) => setFilters((f) => ({ ...f, orgUnit: v }))}
                ouMode={filters.ouMode}
                onOuModeChange={(v) => setFilters((f) => ({ ...f, ouMode: v }))}
                fetchOrgUnits={fetchOrgUnits}
                fetchOrgUnitsByIds={fetchOrgUnitsByIds}
              />
              {!isAggregate && (
                <DateRangeFilter
                  startDate={filters.startDate}
                  endDate={filters.endDate}
                  onChange={(start, end) => setFilters((f) => ({ ...f, startDate: start, endDate: end }))}
                />
              )}
            </div>
            <div>
              <ExportOptions
                dataType={dataType}
                format={format}
                status={filters.status}
                asyncMode={asyncMode}
                onDataTypeChange={setDataType}
                onFormatChange={setFormat}
                onStatusChange={(v) => setFilters((f) => ({ ...f, status: v }))}
                onAsyncModeChange={setAsyncMode}
              />
              <Alert
                type={canFetch ? 'success' : 'warning'}
                showIcon
                style={{ marginBottom: 12 }}
                message={canFetch ? 'Ready to fetch data' : 'Checklist before fetching'}
                description={(
                  <Space direction="vertical" size={2}>
                    {readinessItems.map((item) => (
                      <Typography.Text key={item.label} type={item.done ? 'success' : undefined}>
                        {item.done ? 'Done' : 'Pending'}: {item.label}
                      </Typography.Text>
                    ))}
                  </Space>
                )}
              />
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <>
            {asyncMode && jobStatus && (
              <Card size="small" style={{ marginBottom: 12 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Alert
                    type={jobStatus.outputExpired ? 'warning' : jobStatus.status === 'failed' ? 'error' : jobStatus.status === 'completed' ? 'success' : 'info'}
                    message={jobStatus.outputExpired ? 'Async export output expired' : `Async job ${jobStatus.status}`}
                    description={jobStatus.outputExpired
                      ? 'This export finished earlier, but the retained file has expired. Rerun the export to download it again.'
                      : (jobStatus.error || `Progress: ${jobStatus.progress || 0}%`)}
                    showIcon
                  />
                  <Progress percent={jobStatus.progress || 0} />
                  <Space>
                    {jobStatus.status === 'running' || jobStatus.status === 'queued' ? (
                      <Button onClick={() => cancelExportJob(activeJobId)}>
                        Cancel Job
                      </Button>
                    ) : null}
                    {(jobStatus.status === 'failed' || jobStatus.status === 'cancelled' || jobStatus.outputExpired) && (
                      <Button type="primary" onClick={handleExport}>Retry</Button>
                    )}
                  </Space>
                </Space>
              </Card>
            )}
            <ExportResults data={data} count={count} dataType={dataType} loading={loading} error={error} />
          </>
        )}

        <Divider />
        <Space>
          {currentStep === 0 ? (
            <Button type="primary" onClick={handleExport} loading={loading} icon={<DownloadOutlined />} disabled={!canFetch}>
              Fetch Data
            </Button>
          ) : (
            <>
              <Button onClick={() => setCurrentStep(0)}>← Back to Filters</Button>
              <Button
                type="primary"
                onClick={handleDownload}
                icon={<DownloadOutlined />}
                disabled={asyncMode ? !(jobStatus?.status === 'completed') : data.length === 0}
              >
                Download {format.toUpperCase()}
              </Button>
            </>
          )}
        </Space>
      </Card>
    </div>
  )
}
