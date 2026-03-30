import React from 'react'
import { Form, Select, Radio, Card } from 'antd'

const DATA_TYPES = [
  { value: 'events', label: 'Events' },
  { value: 'enrollments', label: 'Enrollments' },
  { value: 'trackedEntities', label: 'Tracked Entities' },
]

const FORMATS = [
  { value: 'json', label: 'JSON' },
  { value: 'csv', label: 'CSV' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
]

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

export default function ExportOptions({
  dataType,
  format,
  status,
  asyncMode,
  onDataTypeChange,
  onFormatChange,
  onStatusChange,
  onAsyncModeChange,
}) {
  return (
    <Card size="small" title="Export Options" style={{ marginBottom: 12 }}>
      <Form layout="vertical" size="small">
        <Form.Item label="Data Type">
          <Radio.Group
            options={DATA_TYPES}
            value={dataType}
            onChange={(e) => onDataTypeChange(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          />
        </Form.Item>

        <Form.Item label="Export Format">
          <Radio.Group
            options={FORMATS}
            value={format}
            onChange={(e) => onFormatChange(e.target.value)}
            optionType="button"
            buttonStyle="solid"
          />
        </Form.Item>

        <Form.Item label="Status Filter" style={{ marginBottom: 0 }}>
          <Select
            options={STATUS_OPTIONS}
            value={status || ''}
            onChange={(v) => onStatusChange(v || undefined)}
            style={{ width: 180 }}
          />
        </Form.Item>

        <Form.Item label="Execution Mode" style={{ marginTop: 12, marginBottom: 0 }}>
          <Radio.Group
            value={asyncMode ? 'async' : 'sync'}
            onChange={(e) => onAsyncModeChange(e.target.value === 'async')}
            optionType="button"
            buttonStyle="solid"
            options={[
              { label: 'Sync', value: 'sync' },
              { label: 'Async', value: 'async' },
            ]}
          />
        </Form.Item>
      </Form>
    </Card>
  )
}
