import React, { useState } from 'react'
import { Card, Steps, Button, Space, Divider, App, Alert } from 'antd'
import { UploadOutlined, CheckOutlined } from '@ant-design/icons'
import FileUploader from './FileUploader.jsx'
import DataPreview from './DataPreview.jsx'
import MappingEditor from './MappingEditor.jsx'
import ValidationPanel from './ValidationPanel.jsx'
import ImportResults from './ImportResults.jsx'
import { useDhis2Import } from '../../hooks/useDhis2Import.js'
import { csvToJson, readJsonFile } from '../../utils/fileConverters.js'

const STEPS = [
  { title: 'Upload' },
  { title: 'Preview' },
  { title: 'Map Fields' },
  { title: 'Validate' },
  { title: 'Import' },
]

const DEFAULT_OPTIONS = {
  importStrategy: 'CREATE_AND_UPDATE',
  atomicMode: 'ALL',
  async: false,
}

export default function ImportDashboard() {
  const { message } = App.useApp()
  const [step, setStep] = useState(0)
  const [file, setFile] = useState(null)
  const [rawData, setRawData] = useState([])
  const [dataType, setDataType] = useState('events')
  const [mapping, setMapping] = useState({})
  const [options, setOptions] = useState(DEFAULT_OPTIONS)
  const { validateFile, importFile, loading, error, result, validationResult } = useDhis2Import()

  const handleFileSelect = async (uploadedFile) => {
    setFile(uploadedFile)
    const ext = uploadedFile.name.split('.').pop().toLowerCase()
    let rows = []
    try {
      if (ext === 'csv') {
        rows = await csvToJson(uploadedFile)
      } else if (ext === 'json') {
        const json = await readJsonFile(uploadedFile)
        rows = Array.isArray(json) ? json : json.events || json.enrollments || json.trackedEntities || []
      } else if (ext === 'xlsx' || ext === 'xls') {
        // Excel files are parsed server-side during the validate/import steps.
        // Client-side Excel parsing is intentionally avoided to prevent
        // exposure to client-side xlsx library vulnerabilities.
        rows = [{ note: 'Excel file loaded — preview not available locally. Click "Map Fields" to continue.' }]
      }
    } catch {
      rows = []
    }
    setRawData(rows)
    setStep(1)
  }

  const handleValidate = async () => {
    const res = await validateFile(file, dataType, mapping)
    if (res) setStep(3)
  }

  const handleImport = async () => {
    const res = await importFile(file, dataType, mapping, options)
    if (res) setStep(4)
  }

  return (
    <div>
      <Card>
        <Steps current={step} items={STEPS} style={{ marginBottom: 24 }} size="small" />

        {step === 0 && (
          <FileUploader onFileSelect={handleFileSelect} />
        )}

        {step === 1 && (
          <DataPreview
            data={rawData}
            dataType={dataType}
            onDataTypeChange={setDataType}
          />
        )}

        {step === 2 && (
          <MappingEditor
            columns={rawData[0] ? Object.keys(rawData[0]) : []}
            dataType={dataType}
            mapping={mapping}
            onChange={setMapping}
          />
        )}

        {step === 3 && (
          <ValidationPanel
            result={validationResult}
            options={options}
            onOptionsChange={setOptions}
          />
        )}

        {step === 4 && (
          <ImportResults result={result} error={error} />
        )}

        <Divider />

        <Space>
          {step > 0 && step < 4 && (
            <Button onClick={() => setStep((s) => s - 1)}>← Back</Button>
          )}
          {step === 1 && (
            <Button onClick={() => setStep(2)}>Map Fields →</Button>
          )}
          {step === 2 && (
            <Button type="primary" onClick={handleValidate} loading={loading}>
              Validate →
            </Button>
          )}
          {step === 3 && (
            <Button type="primary" onClick={handleImport} loading={loading} icon={<UploadOutlined />}>
              Import Now
            </Button>
          )}
          {step === 4 && (
            <Button
              onClick={() => {
                setStep(0)
                setFile(null)
                setRawData([])
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
