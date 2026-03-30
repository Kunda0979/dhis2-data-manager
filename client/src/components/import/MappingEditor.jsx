import React from 'react'
import { Table, Select, Typography, Alert, Tag } from 'antd'

const { Text } = Typography

// DHIS2 tracker field suggestions by data type
const DHIS2_FIELDS = {
  events: ['event', 'status', 'program', 'programStage', 'orgUnit', 'occurredAt', 'scheduledAt', 'enrollment', 'trackedEntity'],
  enrollments: ['enrollment', 'trackedEntity', 'program', 'orgUnit', 'enrolledAt', 'occurredAt', 'status'],
  trackedEntities: ['trackedEntity', 'trackedEntityType', 'orgUnit'],
}

export default function MappingEditor({ columns = [], dataType, mapping, onChange }) {
  const dhis2Fields = DHIS2_FIELDS[dataType] || []
  const fieldOptions = [
    { value: '', label: '— Skip —' },
    ...dhis2Fields.map((f) => ({ value: f, label: f })),
    { value: '__custom', label: 'Data Element (de_<uid>)' },
    { value: '__attr', label: 'Attribute (attr_<uid>)' },
  ]

  const tableData = columns.map((col) => ({ col, key: col }))

  const handleMappingChange = (col, dhis2Field) => {
    onChange({ ...mapping, [dhis2Field || col]: col })
  }

  const columns_def = [
    {
      title: 'File Column',
      dataIndex: 'col',
      key: 'col',
      render: (v) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Maps to DHIS2 Field',
      dataIndex: 'col',
      key: 'mapping',
      render: (col) => {
        const currentMapping = Object.entries(mapping).find(([, v]) => v === col)?.[0] || ''
        return (
          <Select
            size="small"
            style={{ width: 220 }}
            options={fieldOptions}
            value={currentMapping}
            onChange={(val) => handleMappingChange(col, val)}
            placeholder="Auto-detect"
            allowClear
          />
        )
      },
    },
    {
      title: 'Status',
      dataIndex: 'col',
      key: 'status',
      render: (col) => {
        const isMapped = Object.values(mapping).includes(col)
        return isMapped ? <Tag color="success">Mapped</Tag> : <Tag>Auto</Tag>
      },
    },
  ]

  return (
    <div>
      <Alert
        type="info"
        message="Column Mapping"
        description={`Map your file's columns to DHIS2 ${dataType} fields. Unmapped columns are auto-detected by name.`}
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Table
        dataSource={tableData}
        columns={columns_def}
        size="small"
        pagination={false}
        rowKey="key"
      />
    </div>
  )
}
