import React, { useEffect, useState } from 'react'
import { Table, Tag, Button, Empty, Typography, Space, Popconfirm, App, Input, Select, Alert, Card, Statistic, Row, Col } from 'antd'
import { DeleteOutlined, ReloadOutlined, RedoOutlined } from '@ant-design/icons'
import StatusBadge from '../common/StatusBadge.jsx'
import { useConnection } from '../../contexts/ConnectionContext.jsx'
import api from '../../services/api.js'

const { Text } = Typography

export default function JobHistory() {
  const { message } = App.useApp()
  const { getHeaders } = useConnection()
  const [history, setHistory] = useState([])
  const [retention, setRetention] = useState(null)
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

  const loadRetention = async () => {
    try {
      const res = await api.get('/api/history/retention-status', {
        headers: getHeaders(),
      })
      setRetention(res.data)
    } catch {
      setRetention(null)
    }
  }

  useEffect(() => {
    loadHistory()
    loadRetention()
  }, [filters.type, filters.status, filters.q])

  const handleClear = async () => {
    await api.delete('/api/history', { headers: getHeaders() })
    await loadHistory()
    await loadRetention()
    message.success('History cleared')
  }

  const handleDelete = async (id) => {
    await api.delete(`/api/history/${id}`, { headers: getHeaders() })
    await loadHistory()
    await loadRetention()
  }

  const handleRerun = async (id) => {
    try {
      const res = await api.post(`/api/history/${id}/rerun`, {}, { headers: getHeaders() })
      message.success(`Rerun job created: ${res.data.jobId}`)
      await loadHistory()
      await loadRetention()
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
      render: (v) => {
        const color = v === 'export' ? 'blue' : v === 'import' ? 'purple' : v === 'validation-run' ? 'gold' : 'cyan'
        return <Tag color={color}>{String(v || '').toUpperCase()}</Tag>
      },
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
              { value: 'validation-run', label: 'Validation run' },
              { value: 'completion', label: 'Completion' },
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
              { value: 'blocked', label: 'Blocked' },
              { value: 'expired', label: 'Expired' },
              { value: 'expired-output', label: 'Expired output' },
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
          <Button icon={<ReloadOutlined />} size="small" onClick={async () => {
            await loadHistory()
            await loadRetention()
          }} loading={loading}>
            Refresh
          </Button>
          <Popconfirm title="Clear all history?" onConfirm={handleClear}>
            <Button danger size="small" icon={<DeleteOutlined />}>Clear All</Button>
          </Popconfirm>
        </Space>
      </div>

      {retention && (
        <>
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 12 }}
            message="Retention policy"
            description={`Export output TTL: ${retention.export?.outputRetentionMinutes || 0} min. Import status TTL: ${retention.import?.statusRetentionHours || 0} hr. History TTL: ${retention.history?.retentionHours || 0} hr (${retention.history?.retentionHours ? 'enabled' : 'disabled'}).`}
          />
          <Row gutter={12} style={{ marginBottom: 16 }}>
            <Col xs={24} md={8}>
              <Card size="small">
                <Statistic title="Export Outputs" value={retention.export?.availableOutputs || 0} suffix={`/ ${retention.export?.totalTrackedJobs || 0} jobs`} />
                <Text type="secondary" style={{ fontSize: 12 }}>Expired outputs: {retention.export?.expiredOutputs || 0}</Text>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small">
                <Statistic title="Import Jobs" value={retention.import?.activeJobs || 0} suffix="active" />
                <Text type="secondary" style={{ fontSize: 12 }}>Expired tracked jobs: {retention.import?.expiredJobs || 0}</Text>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card size="small">
                <Statistic title="History Entries" value={retention.history?.totalEntries || 0} suffix={`/ ${retention.history?.maxItems || 0}`} />
                <Text type="secondary" style={{ fontSize: 12 }}>Expired-state entries: {retention.history?.expiredEntries || 0}</Text>
              </Card>
            </Col>
          </Row>
        </>
      )}

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
