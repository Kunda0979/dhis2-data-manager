import React, { useMemo } from 'react'
import { Table, Form, Select, Typography, Tag, Alert } from 'antd'

const { Text } = Typography

const DATA_TYPES = [
  { value: 'events', label: 'Events' },
  { value: 'enrollments', label: 'Enrollments' },
  { value: 'trackedEntities', label: 'Tracked Entities' },
  { value: 'aggregate', label: 'Aggregate Data' },
]

export default function DataPreview({
  data = [],
  dataType,
  onDataTypeChange,
  modelSelection,
  onModelSelectionChange,
  programs = [],
  dataSets = [],
}) {
  const columns = useMemo(() => {
    if (!data || data.length === 0) return []
    return Object.keys(data[0]).slice(0, 12).map((key) => ({
      title: key,
      dataIndex: key,
      key,
      ellipsis: true,
      width: 140,
      render: (val) => (
        <Text style={{ fontSize: 12 }}>{val !== '' && val !== null && val !== undefined ? String(val) : '—'}</Text>
      ),
    }))
  }, [data])

  return (
    <div>
      <div className="flex items-center gap-4 mb-4">
        <Form.Item label="Data Type" style={{ marginBottom: 0 }} required>
          <Select
            options={DATA_TYPES}
            value={dataType}
            onChange={onDataTypeChange}
            style={{ width: 180 }}
          />
        </Form.Item>
        <Tag color="blue">{data.length} rows loaded</Tag>
      </div>

      {dataType === 'aggregate' ? (
        <Form.Item label="Dataset" required style={{ marginBottom: 12 }}>
          <Select
            showSearch
            placeholder="Select dataset"
            optionFilterProp="label"
            options={(dataSets || []).map((item) => ({
              value: item.id,
              label: item.displayName || item.id,
            }))}
            value={modelSelection?.dataSetId || undefined}
            onChange={(value) => onModelSelectionChange({
              ...(modelSelection || {}),
              dataSetId: value || '',
            })}
            style={{ width: 360 }}
          />
        </Form.Item>
      ) : (
        <Form.Item label="Program" required style={{ marginBottom: 12 }}>
          <Select
            showSearch
            placeholder="Select program"
            optionFilterProp="label"
            options={(programs || []).map((item) => ({
              value: item.id,
              label: item.displayName || item.id,
            }))}
            value={modelSelection?.programId || undefined}
            onChange={(value) => onModelSelectionChange({
              ...(modelSelection || {}),
              programId: value || '',
            })}
            style={{ width: 360 }}
          />
        </Form.Item>
      )}

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="Straightforward import flow"
        description="1) Upload your file and select model type + program/dataset. 2) Run Dry Run to validate. 3) Import when validation passes."
      />

      <Table
        dataSource={data.slice(0, 100)}
        columns={columns}
        rowKey={(_, i) => i}
        size="small"
        scroll={{ x: 'max-content', y: 350 }}
        pagination={{ pageSize: 20, size: 'small' }}
      />
    </div>
  )
}
