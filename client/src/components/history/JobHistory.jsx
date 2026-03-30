import React, { useEffect, useState } from 'react'
import { Table, Tag, Button, Empty, Typography, Space, Popconfirm, App } from 'antd'
import { DeleteOutlined, ReloadOutlined } from '@ant-design/icons'
import StatusBadge from '../common/StatusBadge.jsx'

const { Text } = Typography
const STORAGE_KEY = 'dhis2_job_history'

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function addJobToHistory(job) {
  const history = loadHistory()
  history.unshift({ ...job, id: Date.now(), timestamp: new Date().toISOString() })
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(0, 100)))
}

export default function JobHistory() {
  const { message } = App.useApp()
  const [history, setHistory] = useState([])

  useEffect(() => {
    setHistory(loadHistory())
  }, [])

  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY)
    setHistory([])
    message.success('History cleared')
  }

  const handleDelete = (id) => {
    const updated = history.filter((h) => h.id !== id)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    setHistory(updated)
  }

  const columns = [
    {
      title: 'Timestamp',
      dataIndex: 'timestamp',
      key: 'timestamp',
      width: 180,
      render: (v) => <Text style={{ fontSize: 12 }}>{new Date(v).toLocaleString()}</Text>,
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      width: 90,
      render: (v) => <Tag color={v === 'export' ? 'blue' : 'purple'}>{v?.toUpperCase()}</Tag>,
    },
    {
      title: 'Data Type',
      dataIndex: 'dataType',
      key: 'dataType',
      width: 120,
      render: (v) => <Text style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Format',
      dataIndex: 'format',
      key: 'format',
      width: 80,
      render: (v) => v ? <Tag>{v?.toUpperCase()}</Tag> : '—',
    },
    {
      title: 'Records',
      dataIndex: 'count',
      key: 'count',
      width: 90,
      render: (v) => <Text>{v ?? '—'}</Text>,
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      width: 110,
      render: (v) => <StatusBadge status={v} />,
    },
    {
      title: 'Details',
      dataIndex: 'details',
      key: 'details',
      ellipsis: true,
      render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: '',
      key: 'actions',
      width: 50,
      render: (_, row) => (
        <Button
          size="small"
          danger
          icon={<DeleteOutlined />}
          onClick={() => handleDelete(row.id)}
        />
      ),
    },
  ]

  if (history.length === 0) {
    return (
      <Empty
        description="No job history yet. Export or import data to see history here."
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    )
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <Text strong>{history.length} job(s) in history</Text>
        <Space>
          <Button icon={<ReloadOutlined />} size="small" onClick={() => setHistory(loadHistory())}>
            Refresh
          </Button>
          <Popconfirm title="Clear all history?" onConfirm={handleClear}>
            <Button danger size="small" icon={<DeleteOutlined />}>Clear All</Button>
          </Popconfirm>
        </Space>
      </div>
      <Table
        dataSource={history}
        columns={columns}
        rowKey="id"
        size="small"
        pagination={{ pageSize: 20 }}
      />
    </div>
  )
}
