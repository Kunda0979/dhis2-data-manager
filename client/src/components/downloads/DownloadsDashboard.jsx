import React, { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Checkbox, DatePicker, Form, Input, InputNumber, Radio, Select, Space, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { useDhis2Import } from '../../hooks/useDhis2Import.js'
import { useDhis2Metadata } from '../../hooks/useDhis2Metadata.js'

const FORMATS = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
]

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'fr', label: 'French' },
  { value: 'pt', label: 'Portuguese' },
]

const LAYOUT_OPTIONS = [
  { value: 'horizontal', label: 'Horizontal (questions as columns)' },
  { value: 'vertical', label: 'Vertical (questions as rows)' },
]

export default function DownloadsDashboard() {
  const { message } = App.useApp()
  const { programs, orgUnits, fetchPrograms, fetchOrgUnits, loading: metadataLoading } = useDhis2Metadata()
  const { downloadTemplate, previewTemplate } = useDhis2Import()
  const [programId, setProgramId] = useState()
  const [dataType, setDataType] = useState('events')
  const [programStageId, setProgramStageId] = useState()
  const [prepopulate, setPrepopulate] = useState(false)
  const [orgUnitScope, setOrgUnitScope] = useState('all')
  const [selectedOrgUnits, setSelectedOrgUnits] = useState([])
  const [language, setLanguage] = useState('en')
  const [layout, setLayout] = useState('horizontal')
  const [format, setFormat] = useState('csv')
  const [downloading, setDownloading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const [previewSections, setPreviewSections] = useState([])
  const [previewRow, setPreviewRow] = useState(null)

  useEffect(() => {
    fetchPrograms()
    fetchOrgUnits()
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
  const downloadDisabled = !programId
    || (requiresStage && !programStageId)
    || (orgUnitScope === 'specific' && selectedOrgUnits.length === 0)

  useEffect(() => {
    let cancelled = false

    const run = async () => {
      if (downloadDisabled) {
        setPreviewSections([])
        setPreviewRow(null)
        setPreviewError(null)
        return
      }

      const variant = prepopulate ? 'prepopulated' : 'empty'

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
        setPreviewSections(payload?.sections || [])
        setPreviewRow(payload?.sampleRow || {})
      } catch (err) {
        if (cancelled) return
        setPreviewSections([])
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
  }, [dataType, downloadDisabled, prepopulate, previewTemplate, programId, programStageId])

  const defaultInitialValues = useMemo(() => previewRow || {}, [previewRow])

  const renderQuestionInput = (question, value) => {
    const type = String(question?.valueType || 'TEXT').toUpperCase()
    const commonStyle = { width: '100%' }

    if (type === 'BOOLEAN' || type === 'TRUE_ONLY') {
      return <Checkbox checked={String(value).toLowerCase() === 'true'} disabled />
    }

    if (type === 'DATE') {
      return <DatePicker disabled style={commonStyle} placeholder="YYYY-MM-DD" />
    }

    if (type === 'DATETIME') {
      return <DatePicker showTime disabled style={commonStyle} placeholder="YYYY-MM-DD HH:mm:ss" />
    }

    if (['INTEGER', 'INTEGER_POSITIVE', 'INTEGER_NEGATIVE', 'INTEGER_ZERO_OR_POSITIVE', 'NUMBER', 'PERCENTAGE', 'UNIT_INTERVAL'].includes(type)) {
      return <InputNumber disabled style={commonStyle} placeholder={value ? String(value) : ''} />
    }

    if (type === 'LONG_TEXT') {
      return <Input.TextArea disabled rows={2} placeholder={value ? String(value) : ''} />
    }

    return <Input disabled placeholder={value ? String(value) : ''} />
  }

  const handleDownload = async () => {
    if (downloadDisabled) return

    const variant = prepopulate ? 'prepopulated' : 'empty'

    setDownloading(true)
    try {
      await downloadTemplate({
        dataType,
        variant,
        format,
        programId,
        programStageId: dataType === 'events' ? programStageId : undefined,
        orgUnitScope,
        orgUnitIds: selectedOrgUnits,
        language,
        layout,
      })
      message.success(`${variant === 'empty' ? 'Empty template' : 'Pre-populated sample'} downloaded as ${format.toUpperCase()}`)
    } catch (err) {
      message.error(err?.response?.data?.error || err?.message || 'Template download failed')
    } finally {
      setDownloading(false)
    }
  }

  const orgUnitOptions = useMemo(
    () => orgUnits.map((ou) => ({
      value: ou.id,
      label: `${'— '.repeat((ou.level || 1) - 1)}${ou.displayName}`,
    })),
    [orgUnits],
  )

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

      <Card title="Template settings">
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

              <Form.Item label="Organisation unit" required>
                <Radio.Group value={orgUnitScope} onChange={(e) => setOrgUnitScope(e.target.value)}>
                  <Space direction="vertical">
                    <Radio value="all">All user accessible organisation units for program</Radio>
                    <Radio value="specific">Specific individual organisation units</Radio>
                  </Space>
                </Radio.Group>
              </Form.Item>

              {orgUnitScope === 'specific' && (
                <Form.Item label="Select organisation units" required>
                  <Select
                    mode="multiple"
                    showSearch
                    placeholder="Select one or more organisation units"
                    value={selectedOrgUnits}
                    onChange={setSelectedOrgUnits}
                    options={orgUnitOptions}
                    filterOption={(input, option) => option?.label?.toLowerCase().includes(input.toLowerCase())}
                  />
                </Form.Item>
              )}
            </Form>
          </div>

          <div>
            <Form layout="vertical">
              <Form.Item label="Data" required>
                <Checkbox checked={prepopulate} onChange={(e) => setPrepopulate(e.target.checked)}>
                  Prepopulate template with data?
                </Checkbox>
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

              <Form.Item label="Layout">
                <Radio.Group
                  options={LAYOUT_OPTIONS}
                  value={layout}
                  onChange={(e) => setLayout(e.target.value)}
                />
              </Form.Item>

              <Form.Item label="Language">
                <Select value={language} onChange={setLanguage} options={LANGUAGE_OPTIONS} />
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

            {!previewError && previewSections.length > 0 && (
              <Card size="small" title="Template Preview" style={{ marginBottom: 16 }} loading={previewLoading}>
                <Typography.Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
                  Full form view with all sections shown in one continuous layout.
                </Typography.Text>
                <Form layout="vertical" initialValues={defaultInitialValues}>
                  {previewSections.map((section) => (
                    <Card key={section.id || section.name} size="small" style={{ marginBottom: 12 }} title={section.name || 'Section'}>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3">
                        {(section.questions || []).map((question) => (
                          <Form.Item
                            key={question.key}
                            label={question.label}
                            required={Boolean(question.required)}
                            style={{ marginBottom: 10 }}
                          >
                            {renderQuestionInput(question, previewRow?.[question.key])}
                          </Form.Item>
                        ))}
                      </div>
                    </Card>
                  ))}
                </Form>
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
