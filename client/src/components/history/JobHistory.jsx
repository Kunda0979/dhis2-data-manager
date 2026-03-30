import React, { useEffect, useState } from 'react'
import { Table, Tag, Button, Empty, Typography, Space, Popconfirm, App, Input, Select } from 'antd'
import { DeleteOutlined, ReloadOutlined, RedoOutlined } from '@ant-design/icons'
import StatusBadge from '../common/StatusBadge.jsx'
import { useConnection } from '../../contexts/ConnectionContext.jsx'
import api from '../../services/api.js'

const { Text } = Typography

export default function JobHistory() {
  const { message } = App.useApp()
  const { getHeaders } = useConnection()
  const [history, setHistory] = useState([])
  const [filters, setFilters] = useState({ type: '', status: '', q: '' })
  const [loading, setLoading] = useState(false)

  const loadHistory = async () => {
    setLoading(true)
    try {
      const res = await api.get('/api/history', {
        headers: getHeaders(),
        params: {
          type: filters.type || undefined,
          status: filters.status || undefined,
          q: filters.q || undefined,
        },
      })
      setHistory(res.data.entries || [])
    } catch (err) {
      message.error(err.response?.data?.error || err.message || 'Failed to load history')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadHistory()
  }, [filters.type, filters.status, filters.q])

  const handleClear = async () => {
    await api.delete('/api/history', { headers: getHeaders() })
    await loadHistory()
    message.success('History cleared')
  }

  const handleDelete = async (id) => {
    await api.delete(`/api/history/${id}`, { headers: getHeaders() })
    await loadHistory()
  }

  const handleRerun = async (id) => {
    try {
      const res = await api.post(`/api/history/${id}/rerun`, {}, { headers: getHeaders() })
      message.success(`Rerun job created: ${res.data.jobId}`)
      await loadHistory()
    } catch (err) {
      message.error(err.response?.data?.error || 'Unable to rerun this item')
    }
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
      width: 100,
      render: (v) => <Tag color={v === 'export' ? 'blue' : 'purple'}>{String(v || '').toUpperCase()}</Tag>,
    },
    {
      title: 'Mode',
      dataIndex: 'mode',
      key: 'mode',
      width: 90,
      render: (v) => <Tag>{String(v || 'sync').toUpperCase()}</Tag>,
    },
    {
      title: 'Data Type',
      dataIndex: 'dataType',
      key: 'dataType',
      width: 140,
    },
    {
      title: 'Format',
      dataIndex: 'format',
      key: 'format',
      width: 90,
      render: (v) => (v ? <Tag>{String(v).toUpperCase()}</Tag> : '—'),
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
      width: 120,
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
      width: 120,
      render: (_, row) => (
        <Space>
          <Button
            size="small"
            icon={<RedoOutlined />}
            onClick={() => handleRerun(row.id)}
            disabled={row.type !== 'export'}
          />
          <Button
            size="small"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(row.id)}
          />
        </Space>
      ),
    },
  ]

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <Text strong>{history.length} item(s)</Text>
        <Space>
          <Select
            size="small"
            style={{ width: 120 }}
            value={filters.type}
            options={[
              { value: '', label: 'All types' },
              { value: 'export', label: 'Export' },
              { value: 'import', label: 'Import' },
            ]}
            onChange={(value) => setFilters((f) => ({ ...f, type: value }))}
          />
          <Select
            size="small"
            style={{ width: 140 }}
            value={filters.status}
            options={[
              { value: '', label: 'All status' },
              { value: 'success', label: 'Success' },
              { value: 'queued', label: 'Queued' },
              { value: 'running', label: 'Running' },
              { value: 'failed', label: 'Failed' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
            onChange={(value) => setFilters((f) => ({ ...f, status: value }))}
          />
          <Input.Search
            size="small"
            allowClear
            placeholder="Search"
            style={{ width: 180 }}
            onSearch={(q) => setFilters((f) => ({ ...f, q }))}
          />
          <Button icon={<ReloadOutlined />} size="small" onClick={loadHistory} loading={loading}>
            Refresh
          </Button>
          <Popconfirm title="Clear all history?" onConfirm={handleClear}>
            <Button danger size="small" icon={<DeleteOutlined />}>Clear All</Button>
          </Popconfirm>
        </Space>
      </div>

      {history.length === 0 ? (
        <Empty
          description="No job history yet. Run import/export to populate history."
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      ) : (
        <Table
          dataSource={history}
          columns={columns}
          rowKey="id"
          size="small"
          loading={loading}
          pagination={{ pageSize: 20 }}
        />
      )}
    </div>
  )
}
