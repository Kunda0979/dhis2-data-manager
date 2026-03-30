import React, { useState, useEffect } from 'react'
import { Card, Steps, Button, Space, Divider, App, Progress, Alert } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import ProgramSelector from './ProgramSelector.jsx'
import OrgUnitSelector from './OrgUnitSelector.jsx'
import DateRangeFilter from './DateRangeFilter.jsx'
import ExportOptions from './ExportOptions.jsx'
import ExportResults from './ExportResults.jsx'
import { useDhis2Export } from '../../hooks/useDhis2Export.js'
import { useDhis2Metadata } from '../../hooks/useDhis2Metadata.js'

export default function ExportDashboard() {
  const { message } = App.useApp()
  const [currentStep, setCurrentStep] = useState(0)
  const [filters, setFilters] = useState({
    program: undefined,
    orgUnit: undefined,
    ouMode: 'DESCENDANTS',
    startDate: undefined,
    endDate: undefined,
    status: undefined,
  })
  const [dataType, setDataType] = useState('events')
  const [format, setFormat] = useState('json')
  const [asyncMode, setAsyncMode] = useState(false)
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
  const { programs, orgUnits, fetchPrograms, fetchOrgUnits } = useDhis2Metadata()

  useEffect(() => {
    fetchPrograms()
    fetchOrgUnits()
  }, [])

  const handleExport = async () => {
    if (!filters.orgUnit) {
      message.warning('Please select an organisation unit')
      return
    }
    const params = {}
    if (filters.program) params.program = filters.program
    if (filters.orgUnit) params.orgUnit = filters.orgUnit
    if (filters.ouMode) params.ouMode = filters.ouMode
    if (filters.startDate) params.startDate = filters.startDate
    if (filters.endDate) params.endDate = filters.endDate
    if (filters.status) params.status = filters.status

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
    if (filters.program) params.program = filters.program
    if (filters.orgUnit) params.orgUnit = filters.orgUnit
    if (filters.ouMode) params.ouMode = filters.ouMode
    if (filters.startDate) params.startDate = filters.startDate
    if (filters.endDate) params.endDate = filters.endDate

    try {
      if (asyncMode && activeJobId) {
        await downloadExportJob(activeJobId)
        message.success('Downloaded async export result')
      } else {
        await downloadFile(dataType, params, format)
        message.success(`Downloaded ${count} records as ${format.toUpperCase()}`)
      }
    } catch {
      message.error('Download failed')
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
      if (status?.status === 'failed' || status?.status === 'cancelled') {
        clearInterval(timer)
      }
    }, 2000)

    return () => clearInterval(timer)
  }, [activeJobId, dataType, exportData, filters, format, getExportJob])

  const steps = [
    { title: 'Configure', description: 'Set filters' },
    { title: 'Preview', description: 'Review data' },
  ]

  return (
    <div>
      <Card>
        <Steps current={currentStep} items={steps} style={{ marginBottom: 24 }} size="small" />

        {currentStep === 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <ProgramSelector
                programs={programs}
                value={filters.program}
                onChange={(v) => setFilters((f) => ({ ...f, program: v }))}
              />
              <OrgUnitSelector
                orgUnits={orgUnits}
                value={filters.orgUnit}
                onChange={(v) => setFilters((f) => ({ ...f, orgUnit: v }))}
                ouMode={filters.ouMode}
                onOuModeChange={(v) => setFilters((f) => ({ ...f, ouMode: v }))}
              />
              <DateRangeFilter
                startDate={filters.startDate}
                endDate={filters.endDate}
                onChange={(start, end) => setFilters((f) => ({ ...f, startDate: start, endDate: end }))}
              />
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
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <>
            {asyncMode && jobStatus && (
              <Card size="small" style={{ marginBottom: 12 }}>
                <Space direction="vertical" style={{ width: '100%' }}>
                  <Alert
                    type={jobStatus.status === 'failed' ? 'error' : jobStatus.status === 'completed' ? 'success' : 'info'}
                    message={`Async job ${jobStatus.status}`}
                    description={jobStatus.error || `Progress: ${jobStatus.progress || 0}%`}
                    showIcon
                  />
                  <Progress percent={jobStatus.progress || 0} />
                  <Space>
                    {jobStatus.status === 'running' || jobStatus.status === 'queued' ? (
                      <Button onClick={() => cancelExportJob(activeJobId)}>
                        Cancel Job
                      </Button>
                    ) : null}
                    {(jobStatus.status === 'failed' || jobStatus.status === 'cancelled') && (
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
            <Button type="primary" onClick={handleExport} loading={loading} icon={<DownloadOutlined />}>
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
