import React, { useEffect, useMemo, useState } from 'react'
import { Card, Steps, Button, Space, Divider, App, Alert, Modal } from 'antd'
import { UploadOutlined, CheckOutlined } from '@ant-design/icons'
import FileUploader from './FileUploader.jsx'
import DataPreview from './DataPreview.jsx'
import ValidationPanel from './ValidationPanel.jsx'
import ImportResults from './ImportResults.jsx'
import { useDhis2Import } from '../../hooks/useDhis2Import.js'
import { csvToJson, readJsonFile } from '../../utils/fileConverters.js'
import { useDhis2Metadata } from '../../hooks/useDhis2Metadata.js'
import { useConnection } from '../../contexts/ConnectionContext.jsx'

const STEPS = [
  { title: 'Upload & Select Model' },
  { title: 'Dry Run' },
  { title: 'Import' },
]

const DEFAULT_OPTIONS = {
  importStrategy: 'CREATE_AND_UPDATE',
  atomicMode: 'ALL',
  async: false,
  markComplete: false,
  completionDate: '',
  submissionComment: '',
}

function buildValidationContextSignature({ file, dataType, modelSelection, options }) {
  const payload = {
    file: file
      ? {
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type,
      }
      : null,
    dataType,
    modelSelection: {
      programId: modelSelection?.programId || '',
      dataSetId: modelSelection?.dataSetId || '',
    },
    options: {
      importStrategy: options?.importStrategy || 'CREATE_AND_UPDATE',
      atomicMode: options?.atomicMode || 'ALL',
      async: Boolean(options?.async),
      // Keep this aligned with server-side normalizeValidationOptions used in fingerprint.
      programId: modelSelection?.programId || '',
      dataSetId: modelSelection?.dataSetId || '',
      dataSet: modelSelection?.dataSetId || '',
      period: options?.period || '',
      orgUnit: options?.orgUnit || '',
      attributeOptionCombo: options?.attributeOptionCombo || '',
    },
  }

  return JSON.stringify(payload)
}

export default function ImportDashboard() {
  const { message } = App.useApp()
  const { connection, instance } = useConnection()
  const [step, setStep] = useState(0)
  const [file, setFile] = useState(null)
  const [rawData, setRawData] = useState([])
  const [dataType, setDataType] = useState('events')
  const [modelSelection, setModelSelection] = useState({
    programId: '',
    dataSetId: '',
  })
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const [markCompleteTouched, setMarkCompleteTouched] = useState(false)
  const [dryRunAttempted, setDryRunAttempted] = useState(false)
  const {
    validateFile,
    importFile,
    loading,
    error,
    result,
    validationResult,
  } = useDhis2Import()
  const {
    programs,
    dataSets,
    fetchPrograms,
    fetchDataSets,
  } = useDhis2Metadata()
  const [validatedContextSignature, setValidatedContextSignature] = useState('')

  const currentValidationContextSignature = useMemo(() => {
    return buildValidationContextSignature({
      file,
      dataType,
      modelSelection,
      options,
    })
  }, [file, dataType, modelSelection, options])

  useEffect(() => {
    if (dataType === 'aggregate') {
      fetchDataSets()
      return
    }
    fetchPrograms()
  }, [dataType, fetchDataSets, fetchPrograms])

  useEffect(() => {
    if (dataType !== 'aggregate') return
    if (markCompleteTouched) return

    const intent = validationResult?.templateCompletionIntent
    if (!intent || intent.status !== 'ok' || typeof intent.markComplete !== 'boolean') return

    setOptions((prev) => {
      if (prev.markComplete === intent.markComplete) return prev
      return { ...prev, markComplete: intent.markComplete }
    })
  }, [dataType, markCompleteTouched, validationResult])

  const handleFileSelect = async (uploadedFile) => {
    setFile(uploadedFile)
    const ext = uploadedFile.name.split('.').pop().toLowerCase()
    let rows = []
    try {
      if (ext === 'csv') {
        rows = await csvToJson(uploadedFile)
      } else if (ext === 'json') {
        const json = await readJsonFile(uploadedFile)
        rows = Array.isArray(json) ? json : json.events || json.enrollments || json.trackedEntities || json.dataValues || []
        if (!Array.isArray(json) && json.dataValues) {
          setDataType('aggregate')
        }
      } else if (ext === 'xlsx' || ext === 'xls') {
        // Excel files are parsed server-side during the validate/import steps.
        // Client-side Excel parsing is intentionally avoided to prevent
        // exposure to client-side xlsx library vulnerabilities.
        rows = [{ note: 'Excel file loaded — preview not available locally. Continue to run Dry Run.' }]
      }
    } catch {
      rows = []
    }
    setRawData(rows)
    setValidatedContextSignature('')
    setDryRunAttempted(false)
    setMarkCompleteTouched(false)
  }

  const handleValidate = async () => {
    setDryRunAttempted(true)

    if (!file) {
      message.error('Upload a file before running dry run.')
      return
    }

    const needsDataSet = dataType === 'aggregate'
    const hasRequiredSelection = needsDataSet
      ? Boolean(modelSelection.dataSetId)
      : Boolean(modelSelection.programId)

    if (!hasRequiredSelection) {
      message.error(needsDataSet
        ? 'Select a dataset before running dry run.'
        : 'Select a program before running dry run.')
      return
    }

    const runOptions = {
      ...options,
      programId: modelSelection.programId,
      dataSetId: modelSelection.dataSetId,
      dataSet: modelSelection.dataSetId,
    }

    const res = await validateFile(file, dataType, null, runOptions)
    if (!res) {
      message.error('Dry run failed without a response. Please retry.')
      setStep(1)
      return
    }

    setValidatedContextSignature(currentValidationContextSignature)
    setStep(1)

    if (res.valid) {
      if (dataType === 'aggregate' && res.templateCompletionIntent?.status === 'ok') {
        const selectedDecision = res.templateCompletionIntent.markComplete ? 'Submit and Mark Complete' : 'Draft'
        message.success(`Dry run passed. Submission decision from Excel: ${selectedDecision}.`)
        return
      }
      message.success('Dry run passed. You can proceed to import.')
    } else {
      message.warning('Dry run completed with issues. Review the validation details below.')
    }
  }

  const handleImport = async () => {
    if (!validationResult?.valid) {
      message.error('Fix validation issues before importing.')
      return
    }

    if (instance?.isProduction) {
      const confirmed = await new Promise((resolve) => {
        Modal.confirm({
          title: 'Production import confirmation',
          content: `You are importing into PRODUCTION: ${instance?.systemName || connection?.serverInfo?.systemName || 'Unknown instance'} (${instance?.instanceBaseUrl || connection?.serverInfo?.instanceBaseUrl || 'Unknown URL'}). Continue?`,
          okText: 'Proceed with Import',
          okButtonProps: { danger: true },
          cancelText: 'Cancel',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        })
      })

      if (!confirmed) {
        message.info('Import cancelled')
        return
      }
    }

    const res = await importFile(file, dataType, null, {
      ...options,
      programId: modelSelection.programId,
      dataSetId: modelSelection.dataSetId,
      dataSet: modelSelection.dataSetId,
      validationToken: validationResult?.validationToken,
    })
    if (res && !res.failed) {
      setStep(2)
      return
    }

    const hasImportSummaryDetails = Boolean(
      res?.error?.importReport
      || res?.error?.result
      || res?.error?.validationGate,
    )
    setStep(hasImportSummaryDetails ? 2 : 1)
  }

  const validationTokenMismatch = validatedContextSignature !== currentValidationContextSignature
  const requiresDataSet = dataType === 'aggregate'
  const modelSelected = requiresDataSet ? Boolean(modelSelection.dataSetId) : Boolean(modelSelection.programId)
  const canRunDryRun = Boolean(file) && modelSelected
  const importDisabled = !validationResult?.valid
    || !validationResult?.validationToken
    || validationTokenMismatch

  return (
    <div>
      <Card>
        <Steps current={step} items={STEPS} style={{ marginBottom: 24 }} size="small" />

        {instance?.isProduction && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 16 }}
            message="Production DHIS2 instance"
            description={`Imports will affect live data on ${instance?.systemName || connection?.serverInfo?.systemName || 'this instance'} (${instance?.instanceBaseUrl || connection?.serverInfo?.instanceBaseUrl || 'unknown URL'}). Review your file and dry run results carefully before importing.`}
          />
        )}

        {error && step < 2 && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={error?.message || 'Dry run failed'}
            description={error?.hint || 'Check model selection and file contents, then retry dry run.'}
          />
        )}

        {step === 1 && !loading && dryRunAttempted && !validationResult && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message="Dry run did not return results"
            description="No validation payload was returned. Please retry dry run. If this persists, check server logs."
          />
        )}

        {step === 0 && (
          <>
            <FileUploader onFileSelect={handleFileSelect} />
            <Divider />
            <DataPreview
              data={rawData}
              dataType={dataType}
              onDataTypeChange={setDataType}
              modelSelection={modelSelection}
              onModelSelectionChange={setModelSelection}
              programs={programs}
              dataSets={dataSets}
            />
          </>
        )}

        {step === 1 && (
          <ValidationPanel
            result={validationResult}
            options={options}
            onOptionsChange={setOptions}
            onMarkCompleteTouched={() => setMarkCompleteTouched(true)}
            dataType={dataType}
            simpleMode
          />
        )}

        {step === 2 && result?.completionRequested && result?.completionStatus === 'blocked' && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Completion was requested but blocked"
            description={
              result?.nextAction
                || 'Completion was requested in the Excel file but could not be completed. Review the details below.'
            }
          />
        )}

        {step === 2 && (
          <ImportResults result={result} error={error} />
        )}

        <Divider />

        {step === 1 && validationTokenMismatch && (
          <Alert
            type="warning"
            showIcon
            style={{ marginBottom: 12 }}
            message="Validation is out of date"
            description="File, model selection, or options changed after dry run. Run Dry Run again before importing."
          />
        )}

        <Space>
          {step > 0 && step < 2 && (
            <Button onClick={() => setStep((s) => s - 1)}>← Back</Button>
          )}
          {step === 0 && (
            <Button type="primary" onClick={handleValidate} loading={loading} disabled={!canRunDryRun}>
              Run Dry Run →
            </Button>
          )}
          {step === 1 && (
            <Button type="primary" onClick={handleImport} loading={loading} disabled={importDisabled} icon={<UploadOutlined />}>
              Import Now
            </Button>
          )}
          {step === 2 && (
            <Button
              onClick={() => {
                setStep(0)
                setFile(null)
                setRawData([])
                setModelSelection({ programId: '', dataSetId: '' })
                setOptions(DEFAULT_OPTIONS)
                setValidatedContextSignature('')
                setDryRunAttempted(false)
                setMarkCompleteTouched(false)
              }}
              icon={<CheckOutlined />}
            >
              Import Another File
            </Button>
          )}
        </Space>
      </Card>
    </div>
  )
}
