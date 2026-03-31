import React, { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Form, Radio, Select, Space, Table, Tag, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { useDhis2Import } from '../../hooks/useDhis2Import.js'
import { useDhis2Metadata } from '../../hooks/useDhis2Metadata.js'

const FORMATS = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
]

const TEMPLATE_VARIANTS = [
  { value: 'empty', label: 'Empty file' },
  { value: 'prepopulated', label: 'Pre-populated sample' },
]

export default function DownloadsDashboard() {
  const { message } = App.useApp()
  const { programs, fetchPrograms, loading: metadataLoading } = useDhis2Metadata()
  const { downloadTemplate, previewTemplate } = useDhis2Import()
  const [programId, setProgramId] = useState()
  const [dataType, setDataType] = useState('events')
  const [programStageId, setProgramStageId] = useState()
  const [variant, setVariant] = useState('empty')
  const [format, setFormat] = useState('csv')
  const [downloading, setDownloading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const [previewColumns, setPreviewColumns] = useState([])
  const [previewRow, setPreviewRow] = useState(null)

  useEffect(() => {
    fetchPrograms()
  }, [])

  const selectedProgram = useMemo(
    () => programs.find((program) => program.id === programId) || null,
    [programId, programs],
  )

  const stageOptions = useMemo(() => {
    return [...(selectedProgram?.programStages || [])]
      .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
      .map((stage) => ({ value: stage.id, label: stage.displayName }))
  }, [selectedProgram])

  const templateTypeOptions = useMemo(() => {
    if (!selectedProgram) {
      return [
        { value: 'events', label: 'Event template' },
        { value: 'enrollments', label: 'Enrollment template' },
        { value: 'trackedEntities', label: 'Tracked entity template' },
      ]
    }

    if (selectedProgram.programType === 'WITHOUT_REGISTRATION') {
      return [{ value: 'events', label: 'Event template' }]
    }

    return [
      { value: 'events', label: 'Event template' },
      { value: 'enrollments', label: 'Enrollment template' },
      { value: 'trackedEntities', label: 'Tracked entity template' },
    ]
  }, [selectedProgram])

  useEffect(() => {
    if (!selectedProgram) return

    const allowedTypes = new Set(templateTypeOptions.map((item) => item.value))
    if (!allowedTypes.has(dataType)) {
      setDataType(templateTypeOptions[0]?.value || 'events')
    }
  }, [dataType, selectedProgram, templateTypeOptions])

  useEffect(() => {
    if (dataType !== 'events') {
      setProgramStageId(undefined)
      return
    }

    if (stageOptions.length === 0) {
      setProgramStageId(undefined)
      return
    }

    if (!stageOptions.some((option) => option.value === programStageId)) {
      setProgramStageId(stageOptions[0].value)
    }
  }, [dataType, programStageId, stageOptions])

  const programOptions = useMemo(
    () => programs.map((program) => ({
      value: program.id,
      label: `${program.displayName} (${program.programType})`,
    })),
    [programs],
  )

  const requiresStage = dataType === 'events' && stageOptions.length > 0
  const downloadDisabled = !programId || (requiresStage && !programStageId)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (downloadDisabled) {
        setPreviewColumns([])
        setPreviewRow(null)
        setPreviewError(null)
        return
      }

      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const payload = await previewTemplate({
          dataType,
          variant,
          programId,
          programStageId: dataType === 'events' ? programStageId : undefined,
        })
        if (cancelled) return
        setPreviewColumns(payload?.columns || [])
        setPreviewRow(payload?.sampleRow || {})
      } catch (err) {
        if (cancelled) return
        setPreviewColumns([])
        setPreviewRow(null)
        setPreviewError(err?.response?.data?.error || err?.response?.data?.message || err?.message || 'Unable to preview template')
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [dataType, downloadDisabled, previewTemplate, programId, programStageId, variant])

  const tableColumns = useMemo(
    () => previewColumns.map((column) => ({
      title: column,
      dataIndex: column,
      key: column,
      width: 170,
      ellipsis: true,
    })),
    [previewColumns],
  )

  const handleDownload = async () => {
    if (downloadDisabled) return

    setDownloading(true)
    try {
      await downloadTemplate({
        dataType,
        variant,
        format,
        programId,
        programStageId: dataType === 'events' ? programStageId : undefined,
      })
      message.success(`${variant === 'empty' ? 'Empty template' : 'Pre-populated sample'} downloaded as ${format.toUpperCase()}`)
    } catch (err) {
      message.error(err?.response?.data?.error || err?.message || 'Template download failed')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Program Template Downloads
          </Typography.Title>
          <Typography.Text type="secondary">
            Choose a DHIS2 program, download an empty file or a pre-populated sample, complete it offline, then upload it again from the Import section.
          </Typography.Text>
        </Space>
      </Card>

      <Card>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Form layout="vertical">
              <Form.Item label="Program" required>
                <Select
                  showSearch
                  placeholder="Select a DHIS2 program"
                  value={programId}
                  onChange={setProgramId}
                  options={programOptions}
                  loading={metadataLoading}
                  filterOption={(input, option) => option?.label?.toLowerCase().includes(input.toLowerCase())}
                />
              </Form.Item>

              <Form.Item label="Template Type" required>
                <Radio.Group
                  options={templateTypeOptions}
                  value={dataType}
                  onChange={(e) => setDataType(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                />
              </Form.Item>

              {requiresStage && (
                <Form.Item label="Program Stage" required>
                  <Select
                    placeholder="Select a program stage"
                    value={programStageId}
                    onChange={setProgramStageId}
                    options={stageOptions}
                  />
                </Form.Item>
              )}
            </Form>
          </div>

          <div>
            <Form layout="vertical">
              <Form.Item label="Template Contents" required>
                <Radio.Group
                  options={TEMPLATE_VARIANTS}
                  value={variant}
                  onChange={(e) => setVariant(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                />
              </Form.Item>

              <Form.Item label="File Format" required>
                <Radio.Group
                  options={FORMATS}
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                />
              </Form.Item>
            </Form>

            <Alert
              type="info"
              showIcon
              message="How this works"
              description={dataType === 'events'
                ? 'The download includes the selected program, the chosen stage, and one column per stage data element. Keep the de_* headers unchanged to import back without remapping.'
                : dataType === 'trackedEntities'
                  ? 'The download includes tracked entity attribute columns using attr_* headers derived from the selected program and tracked entity type.'
                  : 'The download includes the core enrollment columns required by the current import flow so the file can be completed and uploaded from Import.'}
              style={{ marginBottom: 16 }}
            />

            {previewError && (
              <Alert
                type="error"
                showIcon
                message="Template validation issue"
                description={previewError}
                style={{ marginBottom: 16 }}
              />
            )}

            {!previewError && previewColumns.length > 0 && (
              <Card size="small" title="Template Preview" style={{ marginBottom: 16 }} loading={previewLoading}>
                <Space size={[6, 6]} wrap style={{ marginBottom: 12 }}>
                  {previewColumns.map((column) => (
                    <Tag key={column}>{column}</Tag>
                  ))}
                </Space>
                <Table
                  size="small"
                  columns={tableColumns}
                  dataSource={previewRow ? [{ key: 'sample', ...previewRow }] : []}
                  pagination={false}
                  scroll={{ x: 'max-content' }}
                />
              </Card>
            )}

            <Button
              type="primary"
              size="large"
              icon={<DownloadOutlined />}
              onClick={handleDownload}
              loading={downloading}
              disabled={downloadDisabled}
            >
              Download Template
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
