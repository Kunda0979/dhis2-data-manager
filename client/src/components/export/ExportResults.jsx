import React, { useMemo } from 'react'
import { Table, Alert, Tag, Typography, Empty } from 'antd'

const { Text } = Typography

export default function ExportResults({ data = [], count, dataType, loading, error }) {
  const columns = useMemo(() => {
    if (!data || data.length === 0) return []
    const keys = Object.keys(data[0]).slice(0, 10) // Show first 10 columns
    return keys.map((key) => ({
      title: key,
      dataIndex: key,
      key,
      ellipsis: true,
      width: 150,
      render: (val) => {
        if (val === null || val === undefined) return <Text type="secondary">—</Text>
        if (typeof val === 'object') return <Text type="secondary">[object]</Text>
        return <Text style={{ fontSize: 12 }}>{String(val)}</Text>
      },
    }))
  }, [data])

  if (error) {
    return <Alert type="error" message="Export failed" description={error} showIcon />
  }

  if (!loading && data.length === 0) {
    return <Empty description="No data found. Try adjusting your filters." />
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Text strong>Results:</Text>
        <Tag color="blue">{count} records fetched</Tag>
        {data.length > 0 && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            Showing first {Math.min(data.length, 100)} rows
          </Text>
        )}
      </div>
      <Table
        dataSource={data.slice(0, 100)}
        columns={columns}
        rowKey={(_, i) => i}
        size="small"
        scroll={{ x: 'max-content', y: 400 }}
        loading={loading}
        pagination={{ pageSize: 20, size: 'small' }}
      />
    </div>
  )
}
