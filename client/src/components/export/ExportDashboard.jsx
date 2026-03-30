import React, { useState, useEffect } from 'react'
import { Card, Steps, Button, Space, Divider, App } from 'antd'
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

  const { exportData, downloadFile, data, loading, error, count } = useDhis2Export()
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

    await exportData(dataType, params)
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
      await downloadFile(dataType, params, format)
      message.success(`Downloaded ${count} records as ${format.toUpperCase()}`)
    } catch {
      message.error('Download failed')
    }
  }

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
                onDataTypeChange={setDataType}
                onFormatChange={setFormat}
                onStatusChange={(v) => setFilters((f) => ({ ...f, status: v }))}
              />
            </div>
          </div>
        )}

        {currentStep === 1 && (
          <ExportResults data={data} count={count} dataType={dataType} loading={loading} error={error} />
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
              <Button type="primary" onClick={handleDownload} icon={<DownloadOutlined />} disabled={data.length === 0}>
                Download {format.toUpperCase()}
              </Button>
            </>
          )}
        </Space>
      </Card>
    </div>
  )
}
