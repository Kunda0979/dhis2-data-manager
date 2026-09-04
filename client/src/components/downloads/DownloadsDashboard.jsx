import React, { useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Card, Checkbox, DatePicker, Form, Input, InputNumber, Radio, Select, Space, Steps, Typography } from 'antd'
import { DownloadOutlined, InfoCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useDhis2Import } from '../../hooks/useDhis2Import.js'
import { useDhis2Metadata } from '../../hooks/useDhis2Metadata.js'
import { normalizeApiError, toUserErrorText } from '../../utils/apiError.js'

const FORMATS = [
  { value: 'xlsx', label: 'Excel (.xlsx) - Recommended guided template' },
  { value: 'csv', label: 'CSV - Advanced (validate after upload)' },
  { value: 'json', label: 'JSON' },
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

const TEMPLATE_PREFS_KEY = 'dhis2_template_prefs'

function loadTemplatePrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_PREFS_KEY) || '{}')
    return {
      dataType: parsed.dataType || 'events',
      period: parsed.period || '',
      startPeriod: parsed.startPeriod || '',
      endPeriod: parsed.endPeriod || '',
      prepopulate: Boolean(parsed.prepopulate),
      orgUnitScope: parsed.orgUnitScope || 'all',
      language: parsed.language || 'en',
      layout: parsed.layout || 'horizontal',
      format: parsed.format || 'xlsx',
    }
  } catch {
    return {
      dataType: 'events',
      period: '',
      startPeriod: '',
      endPeriod: '',
      prepopulate: false,
      orgUnitScope: 'all',
      language: 'en',
      layout: 'horizontal',
      format: 'xlsx',
    }
  }
}

export default function DownloadsDashboard() {
  const savedPrefs = loadTemplatePrefs()
  const { message } = App.useApp()
  const {
    programs,
    dataSets,
    fetchPrograms,
    fetchDataSets,
    fetchOrgUnits,
    fetchOrgUnitsByIds,
    loading: metadataLoading,
  } = useDhis2Metadata()
  const { downloadTemplate, previewTemplate } = useDhis2Import()
  const [programId, setProgramId] = useState()
  const [dataSetId, setDataSetId] = useState()
  const [dataType, setDataType] = useState(savedPrefs.dataType)
  const [period, setPeriod] = useState(savedPrefs.period)
  const [startPeriod, setStartPeriod] = useState(savedPrefs.startPeriod)
  const [endPeriod, setEndPeriod] = useState(savedPrefs.endPeriod)
  const [programStageId, setProgramStageId] = useState()
  const [prepopulate, setPrepopulate] = useState(savedPrefs.prepopulate)
  const [orgUnitScope, setOrgUnitScope] = useState(savedPrefs.orgUnitScope)
  const [selectedOrgUnits, setSelectedOrgUnits] = useState([])
  const [specificOrgUnitOptions, setSpecificOrgUnitOptions] = useState([])
  const [orgUnitSearchLoading, setOrgUnitSearchLoading] = useState(false)
  const [language, setLanguage] = useState(savedPrefs.language)
  const [layout, setLayout] = useState(savedPrefs.layout)
  const [format, setFormat] = useState(savedPrefs.format)
  const [downloading, setDownloading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const [previewSections, setPreviewSections] = useState([])
  const [previewRow, setPreviewRow] = useState(null)

  useEffect(() => {
    fetchPrograms()
    fetchDataSets()
  }, [])

  const handleRefreshMetadata = async () => {
    await Promise.all([
      fetchPrograms({ refresh: true }),
      fetchDataSets({ refresh: true }),
    ])
    if (orgUnitScope === 'specific') {
      await loadSpecificOrgUnits({ refresh: true })
    }
    message.success('Metadata refreshed')
  }

  const loadSpecificOrgUnits = async ({ search = '', refresh = false } = {}) => {
    setOrgUnitSearchLoading(true)
    try {
      const response = await fetchOrgUnits({
        search: search || undefined,
        level: search ? undefined : 1,
        page: 1,
        pageSize: 75,
        withinUserHierarchy: true,
        persist: false,
        refresh,
      })

      setSpecificOrgUnitOptions((response.organisationUnits || []).map((ou) => ({
        value: ou.id,
        label: `${'— '.repeat(Math.max((ou.level || 1) - 1, 0))}${ou.displayName}`,
      })))
    } finally {
      setOrgUnitSearchLoading(false)
    }
  }

  useEffect(() => {
    if (orgUnitScope !== 'specific') return
    loadSpecificOrgUnits()
  }, [orgUnitScope])

  useEffect(() => {
    if (selectedOrgUnits.length === 0) return
    let cancelled = false

    const hydrateSelectedOrgUnits = async () => {
      const loaded = await fetchOrgUnitsByIds(selectedOrgUnits)
      if (cancelled || loaded.length === 0) return
      setSpecificOrgUnitOptions((current) => {
        const next = [...current]
        const known = new Set(next.map((item) => item.value))
        for (const ou of loaded) {
          if (!known.has(ou.id)) {
            next.push({
              value: ou.id,
              label: `${'— '.repeat(Math.max((ou.level || 1) - 1, 0))}${ou.displayName}`,
            })
            known.add(ou.id)
          }
        }
        return next
      })
    }

    hydrateSelectedOrgUnits()
    return () => {
      cancelled = true
    }
  }, [fetchOrgUnitsByIds, selectedOrgUnits])

  const isAggregate = dataType === 'aggregate'

  const selectedProgram = useMemo(
    () => programs.find((program) => program.id === programId) || null,
    [programId, programs],
  )

  const selectedDataSet = useMemo(
    () => dataSets.find((set) => set.id === dataSetId) || null,
    [dataSetId, dataSets],
  )

  const defaultPeriodByType = (periodType) => {
    const now = new Date()
    const year = now.getUTCFullYear()
    const month = String(now.getUTCMonth() + 1).padStart(2, '0')
    const quarter = Math.floor(now.getUTCMonth() / 3) + 1
    if (periodType === 'Monthly') return `${year}${month}`
    if (periodType === 'Quarterly') return `${year}Q${quarter}`
    if (periodType === 'SixMonthly') return `${year}S1`
    return String(year)
  }

  const defaultFrequencyByType = (periodType) => {
    if (periodType === 'Monthly') return 'monthly'
    if (periodType === 'Quarterly') return 'quarterly'
    if (periodType === 'SixMonthly') return 'biannual'
    return 'yearly'
  }

  const aggregatePeriodFrequency = useMemo(
    () => defaultFrequencyByType(selectedDataSet?.periodType),
    [selectedDataSet],
  )

  const formatPeriodFromDate = (date, frequency) => {
    if (!date) return ''
    const year = date.year()
    if (frequency === 'monthly') {
      const month = String(date.month() + 1).padStart(2, '0')
      return `${year}${month}`
    }
    if (frequency === 'quarterly') {
      const quarter = Math.floor(date.month() / 3) + 1
      return `${year}Q${quarter}`
    }
    if (frequency === 'biannual') {
      const half = date.month() < 6 ? 1 : 2
      return `${year}S${half}`
    }
    return String(year)
  }

  const parsePeriodToDate = (periodValue, frequency) => {
    const value = String(periodValue || '')
    if (!value) return null

    if (frequency === 'monthly') {
      const match = value.match(/^(\d{4})(\d{2})$/)
      if (!match) return null
      const month = Number(match[2])
      if (month < 1 || month > 12) return null
      return dayjs(`${match[1]}-${String(month).padStart(2, '0')}-01`)
    }

    if (frequency === 'quarterly') {
      const match = value.match(/^(\d{4})Q([1-4])$/i)
      if (!match) return null
      const month = (Number(match[2]) - 1) * 3 + 1
      return dayjs(`${match[1]}-${String(month).padStart(2, '0')}-01`)
    }

    if (frequency === 'biannual') {
      const match = value.match(/^(\d{4})S([1-2])$/i)
      if (!match) return null
      const month = Number(match[2]) === 1 ? 1 : 7
      return dayjs(`${match[1]}-${String(month).padStart(2, '0')}-01`)
    }

    if (frequency === 'yearly') {
      const match = value.match(/^(\d{4})$/)
      if (!match) return null
      return dayjs(`${match[1]}-01-01`)
    }

    return null
  }

  const pickerModeByFrequency = (frequency) => {
    if (frequency === 'monthly') return 'month'
    if (frequency === 'quarterly') return 'quarter'
    if (frequency === 'yearly') return 'year'
    return 'month'
  }

  const pickerDisplayFormatByFrequency = (frequency) => {
    if (frequency === 'monthly') return 'YYYY-MM'
    if (frequency === 'quarterly') return 'YYYY-[Q]Q'
    if (frequency === 'yearly') return 'YYYY'
    return 'YYYY-MM'
  }

  const periodSortValue = (periodValue, frequency) => {
    const value = String(periodValue || '')
    if (!value) return Number.NaN

    if (frequency === 'monthly') {
      const match = value.match(/^(\d{4})(\d{2})$/)
      if (!match) return Number.NaN
      return Number(match[1]) * 100 + Number(match[2])
    }

    if (frequency === 'quarterly') {
      const match = value.match(/^(\d{4})Q([1-4])$/i)
      if (!match) return Number.NaN
      return Number(match[1]) * 10 + Number(match[2])
    }

    if (frequency === 'biannual') {
      const match = value.match(/^(\d{4})S([1-2])$/i)
      if (!match) return Number.NaN
      return Number(match[1]) * 10 + Number(match[2])
    }

    if (frequency === 'yearly') {
      const match = value.match(/^(\d{4})$/)
      if (!match) return Number.NaN
      return Number(match[1])
    }

    return Number.NaN
  }

  const periodPlaceholderByFrequency = (frequency) => {
    if (frequency === 'monthly') return 'e.g. 202601'
    if (frequency === 'quarterly') return 'e.g. 2026Q1'
    if (frequency === 'biannual') return 'e.g. 2026S1'
    return 'e.g. 2026'
  }

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
        { value: 'aggregate', label: 'Aggregate template' },
      ]
    }

    if (selectedProgram.programType === 'WITHOUT_REGISTRATION') {
      return [
        { value: 'events', label: 'Event template' },
        { value: 'aggregate', label: 'Aggregate template' },
      ]
    }

    return [
      { value: 'events', label: 'Event template' },
      { value: 'enrollments', label: 'Enrollment template' },
      { value: 'trackedEntities', label: 'Tracked entity template' },
      { value: 'aggregate', label: 'Aggregate template' },
    ]
  }, [selectedProgram])

  useEffect(() => {
    if (isAggregate) return
    if (!selectedProgram) return

    const allowedTypes = new Set(templateTypeOptions.map((item) => item.value))
    if (!allowedTypes.has(dataType)) {
      setDataType(templateTypeOptions[0]?.value || 'events')
    }
  }, [dataType, isAggregate, selectedProgram, templateTypeOptions])

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

  const hasInvalidAggregateRange = useMemo(() => {
    if (!isAggregate || !startPeriod || !endPeriod || !aggregatePeriodFrequency) return false
    const startValue = periodSortValue(startPeriod, aggregatePeriodFrequency)
    const endValue = periodSortValue(endPeriod, aggregatePeriodFrequency)
    if (Number.isNaN(startValue) || Number.isNaN(endValue)) return false
    return startValue > endValue
  }, [isAggregate, startPeriod, endPeriod, aggregatePeriodFrequency])

  const requiresStage = dataType === 'events' && stageOptions.length > 0
  const downloadDisabled = (isAggregate ? (!dataSetId || !startPeriod || !endPeriod || hasInvalidAggregateRange) : !programId)
    || (requiresStage && !programStageId)
    || (orgUnitScope === 'specific' && selectedOrgUnits.length === 0)

  useEffect(() => {
    if (!isAggregate) return
    if (!selectedDataSet) return
    const defaultPeriod = defaultPeriodByType(selectedDataSet.periodType)
    if (!period) setPeriod(defaultPeriod)
    if (!startPeriod) setStartPeriod(defaultPeriod)
    if (!endPeriod) setEndPeriod(defaultPeriod)
  }, [isAggregate, period, selectedDataSet])

  useEffect(() => {
    localStorage.setItem(TEMPLATE_PREFS_KEY, JSON.stringify({
      dataType,
      period,
      startPeriod,
      endPeriod,
      prepopulate,
      orgUnitScope,
      language,
      layout,
      format,
    }))
  }, [dataType, period, startPeriod, endPeriod, prepopulate, orgUnitScope, language, layout, format])

  const readinessItems = useMemo(() => ([
    { done: isAggregate ? Boolean(dataSetId) : Boolean(programId), label: isAggregate ? 'Dataset selected' : 'Program selected' },
    { done: !isAggregate || Boolean(aggregatePeriodFrequency), label: isAggregate ? `Frequency auto-set to ${aggregatePeriodFrequency}` : 'Period frequency selected' },
    { done: !isAggregate || Boolean(startPeriod), label: 'Start period selected' },
    { done: !isAggregate || Boolean(endPeriod), label: 'End period selected' },
    { done: !requiresStage || Boolean(programStageId), label: 'Program stage selected (for event templates)' },
    { done: orgUnitScope !== 'specific' || selectedOrgUnits.length > 0, label: 'Organisation unit scope is valid' },
  ]), [dataSetId, isAggregate, orgUnitScope, aggregatePeriodFrequency, startPeriod, endPeriod, programId, programStageId, requiresStage, selectedOrgUnits.length])

  const wizardStep = !(isAggregate ? (dataSetId && startPeriod && endPeriod && !hasInvalidAggregateRange) : programId)
    ? 0
    : (!requiresStage || programStageId)
      ? ((orgUnitScope !== 'specific' || selectedOrgUnits.length > 0) ? 3 : 2)
      : 1

  const aggregatePeriodHint = useMemo(() => {
    if (!isAggregate) return null
    if (!aggregatePeriodFrequency) return null
    if (!startPeriod || !endPeriod) return null

    return {
      frequency: aggregatePeriodFrequency,
      start: startPeriod,
      end: endPeriod,
    }
  }, [isAggregate, aggregatePeriodFrequency, startPeriod, endPeriod])

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
          programId: isAggregate ? undefined : programId,
          dataSetId: isAggregate ? dataSetId : undefined,
          period: isAggregate ? period : undefined,
          periodFrequency: isAggregate ? aggregatePeriodFrequency : undefined,
          startPeriod: isAggregate ? startPeriod : undefined,
          endPeriod: isAggregate ? endPeriod : undefined,
          programStageId: dataType === 'events' ? programStageId : undefined,
        })
        if (cancelled) return
        setPreviewSections(payload?.sections || [])
        setPreviewRow(payload?.sampleRow || {})
      } catch (err) {
        if (cancelled) return
        setPreviewSections([])
        setPreviewRow(null)
        const normalized = normalizeApiError(err)
        setPreviewError(toUserErrorText(normalized))
      } finally {
        if (!cancelled) setPreviewLoading(false)
      }
    }

    run()

    return () => {
      cancelled = true
    }
  }, [dataSetId, dataType, downloadDisabled, isAggregate, period, aggregatePeriodFrequency, startPeriod, endPeriod, prepopulate, previewTemplate, programId, programStageId])

  const defaultInitialValues = useMemo(() => previewRow || {}, [previewRow])

  const resolvePreviewOptionValue = (question, value) => {
    const options = Array.isArray(question?.options) ? question.options : []
    const raw = String(value ?? '').trim()
    if (!raw || options.length === 0) return undefined

    const exact = options.find((option) => String(option).trim() === raw)
    if (exact) return exact

    const prefixed = options.find((option) => String(option).startsWith(`${raw} - `))
    if (prefixed) return prefixed

    return undefined
  }

  const renderQuestionInput = (question, value) => {
    const type = String(question?.valueType || 'TEXT').toUpperCase()
    const commonStyle = { width: '100%' }
    const options = Array.isArray(question?.options) ? question.options : []
    const optionValue = resolvePreviewOptionValue(question, value)

    if (options.length > 0) {
      return (
        <Select
          disabled
          style={commonStyle}
          value={optionValue}
          placeholder={optionValue || (value ? String(value) : undefined)}
          options={options.map((option) => ({ value: option, label: option }))}
        />
      )
    }

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
        programId: isAggregate ? undefined : programId,
        dataSetId: isAggregate ? dataSetId : undefined,
        period: isAggregate ? period : undefined,
        periodFrequency: isAggregate ? aggregatePeriodFrequency : undefined,
        startPeriod: isAggregate ? startPeriod : undefined,
        endPeriod: isAggregate ? endPeriod : undefined,
        programStageId: dataType === 'events' ? programStageId : undefined,
        orgUnitScope,
        orgUnitIds: selectedOrgUnits,
        language,
        layout,
      })
      message.success(`${variant === 'empty' ? 'Empty template' : 'Pre-populated sample'} downloaded as ${format.toUpperCase()}`)
    } catch (err) {
      message.error(toUserErrorText(normalizeApiError(err)))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <Card style={{ marginBottom: 16 }}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            Template Downloads
          </Typography.Title>
          <Typography.Text type="secondary">
            Choose a tracker program or aggregate dataset, download an empty file or a pre-populated sample, complete it offline, then upload it from Import.
          </Typography.Text>
          <Steps
            size="small"
            current={wizardStep}
            items={[
              { title: 'Source' },
              { title: 'Template Type' },
              { title: 'Scope' },
              { title: 'Download' },
            ]}
          />
        </Space>
      </Card>

      <Card title="Template settings">
        <Space style={{ marginBottom: 12 }}>
          <Button size="small" onClick={handleRefreshMetadata}>Refresh metadata</Button>
        </Space>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Form layout="vertical">
              {isAggregate ? (
                <>
                  <Form.Item label="Dataset" required>
                    <Select
                      showSearch
                      placeholder="Select a DHIS2 dataset"
                      value={dataSetId}
                      onChange={setDataSetId}
                      options={dataSets.map((set) => ({
                        value: set.id,
                        label: `${set.displayName} (${set.periodType || 'Period'})`,
                      }))}
                      loading={metadataLoading}
                      filterOption={(input, option) => option?.label?.toLowerCase().includes(input.toLowerCase())}
                    />
                  </Form.Item>

                  <Form.Item
                    label={`Period${selectedDataSet?.periodType ? ` (${selectedDataSet.periodType})` : ''}`}
                    required
                  >
                    <Space direction="vertical" style={{ width: '100%' }}>
                      <Alert
                        type="info"
                        showIcon
                        message={`Frequency: ${aggregatePeriodFrequency}`}
                        description="Frequency is determined automatically by the selected dataset period type."
                      />
                      <DatePicker
                        picker={pickerModeByFrequency(aggregatePeriodFrequency)}
                        format={pickerDisplayFormatByFrequency(aggregatePeriodFrequency)}
                        placeholder={`Start ${periodPlaceholderByFrequency(aggregatePeriodFrequency)}`}
                        style={{ width: '100%' }}
                        value={parsePeriodToDate(startPeriod, aggregatePeriodFrequency)}
                        onChange={(value) => {
                          const next = formatPeriodFromDate(value, aggregatePeriodFrequency)
                          setStartPeriod(next)
                          if (!period) setPeriod(next)
                        }}
                        disabledDate={(current) => {
                          if (!current) return false
                          if (aggregatePeriodFrequency !== 'biannual') return false
                          const month = current.month() + 1
                          return month !== 1 && month !== 7
                        }}
                      />
                      <DatePicker
                        picker={pickerModeByFrequency(aggregatePeriodFrequency)}
                        format={pickerDisplayFormatByFrequency(aggregatePeriodFrequency)}
                        placeholder={`End ${periodPlaceholderByFrequency(aggregatePeriodFrequency)}`}
                        style={{ width: '100%' }}
                        value={parsePeriodToDate(endPeriod, aggregatePeriodFrequency)}
                        onChange={(value) => setEndPeriod(formatPeriodFromDate(value, aggregatePeriodFrequency))}
                        disabledDate={(current) => {
                          if (!current) return false
                          if (aggregatePeriodFrequency === 'biannual') {
                            const month = current.month() + 1
                            if (month !== 1 && month !== 7) return true
                          }

                          const startDate = parsePeriodToDate(startPeriod, aggregatePeriodFrequency)
                          if (!startDate) return false
                          const currentValue = formatPeriodFromDate(current, aggregatePeriodFrequency)
                          const startValue = formatPeriodFromDate(startDate, aggregatePeriodFrequency)
                          return periodSortValue(currentValue, aggregatePeriodFrequency) < periodSortValue(startValue, aggregatePeriodFrequency)
                        }}
                      />
                      {hasInvalidAggregateRange && (
                        <Typography.Text type="danger" style={{ fontSize: 12 }}>
                          End period must be the same as or after the start period.
                        </Typography.Text>
                      )}
                      {aggregatePeriodHint && !hasInvalidAggregateRange && (
                        <Alert
                          type="info"
                          showIcon
                          message="DHIS2 period request preview"
                          description={`frequency=${aggregatePeriodHint.frequency}, startPeriod=${aggregatePeriodHint.start}, endPeriod=${aggregatePeriodHint.end}`}
                        />
                      )}
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        Use a period range. Templates will include all periods from start to end based on the selected frequency.
                      </Typography.Text>
                    </Space>
                  </Form.Item>
                </>
              ) : (
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
              )}

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
                    <Radio value="all">All user accessible organisation units</Radio>
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
                    options={specificOrgUnitOptions}
                    filterOption={false}
                    loading={orgUnitSearchLoading}
                    onSearch={(value) => loadSpecificOrgUnits({ search: value })}
                    onDropdownVisibleChange={(open) => {
                      if (open && specificOrgUnitOptions.length === 0) {
                        loadSpecificOrgUnits()
                      }
                    }}
                  />
                </Form.Item>
              )}
            </Form>
          </div>

          <div>
            <Form layout="vertical">
              <Form.Item label="Data" required>
                <Checkbox checked={prepopulate} onChange={(e) => setPrepopulate(e.target.checked)}>
                  {isAggregate ? 'Prepopulate with existing dataset values?' : 'Prepopulate template with data?'}
                </Checkbox>
              </Form.Item>

              <Form.Item label="File Format" required>
                <Alert
                  type="info"
                  showIcon
                  style={{ marginBottom: 8 }}
                  message="Download format contract"
                  description="Excel is the recommended guided format with enforced structure, protected sheets, and offline validation cues. CSV is advanced and cannot enforce offline validation; full validation occurs during upload/validate."
                />
                <Radio.Group
                  options={FORMATS}
                  value={format}
                  onChange={(e) => setFormat(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                />
                <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                  <InfoCircleOutlined style={{ marginRight: 6 }} />
                  {format === 'xlsx'
                    ? 'Excel selected: guided constraints and clearer offline guidance are included.'
                    : format === 'csv'
                      ? 'CSV selected: advanced mode. Validation and constraint checks run after upload/validate.'
                      : 'JSON selected: raw data-oriented format without guided worksheet constraints.'}
                </Typography.Text>
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
                ? 'The spreadsheet includes plain-language questions, highlighted required fields, and a protected structure. Fill only the shaded data-entry cells in the Data sheet.'
                : dataType === 'trackedEntities'
                  ? 'The template includes user-friendly attribute labels and a Start Here sheet with instructions for non-technical users.'
                  : dataType === 'aggregate'
                    ? 'The template includes aggregate question columns, selected period choices, and organisation unit names for direct upload into DHIS2.'
                    : 'The template includes enrollment fields with required columns highlighted so the completed file can be uploaded directly from Import.'}
              style={{ marginBottom: 16 }}
            />

            <Alert
              type={downloadDisabled ? 'warning' : 'success'}
              showIcon
              message={downloadDisabled ? 'Readiness checklist' : 'Ready to download'}
              description={(
                <Space direction="vertical" size={2}>
                  {readinessItems.map((item) => (
                    <Typography.Text key={item.label} type={item.done ? 'success' : undefined}>
                      {item.done ? 'Done' : 'Pending'}: {item.label}
                    </Typography.Text>
                  ))}
                </Space>
              )}
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
