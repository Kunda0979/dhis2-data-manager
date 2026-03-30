import React, { useMemo } from 'react'
import { Table, Form, Select, Typography, Tag } from 'antd'

const { Text } = Typography

const DATA_TYPES = [
  { value: 'events', label: 'Events' },
  { value: 'enrollments', label: 'Enrollments' },
  { value: 'trackedEntities', label: 'Tracked Entities' },
]

export default function DataPreview({ data = [], dataType, onDataTypeChange }) {
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
