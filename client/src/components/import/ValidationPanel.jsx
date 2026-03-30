import React from 'react'
import { Alert, Card, Form, Select, Switch, Typography, Space, Tag, List } from 'antd'
import { CheckCircleOutlined, WarningOutlined, CloseCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

const STRATEGIES = [
  { value: 'CREATE', label: 'CREATE – only create new records' },
  { value: 'UPDATE', label: 'UPDATE – only update existing records' },
  { value: 'CREATE_AND_UPDATE', label: 'CREATE_AND_UPDATE (recommended)' },
  { value: 'DELETE', label: 'DELETE – remove records' },
]

const ATOMIC_MODES = [
  { value: 'ALL', label: 'ALL – all or nothing' },
  { value: 'OBJECT', label: 'OBJECT – continue on individual errors' },
]

export default function ValidationPanel({ result, options, onOptionsChange }) {
  return (
    <div>
      {result && (
        <div style={{ marginBottom: 16 }}>
          {result.valid ? (
            <Alert
              type="success"
              icon={<CheckCircleOutlined />}
              message={`Validation passed — ready to import`}
              description={
                <Space>
                  <Tag color="blue">{result.counts?.events || 0} events</Tag>
                  <Tag color="purple">{result.counts?.enrollments || 0} enrollments</Tag>
                  <Tag color="cyan">{result.counts?.trackedEntities || 0} tracked entities</Tag>
                </Space>
              }
              showIcon
            />
          ) : (
            <Alert
              type="error"
              icon={<CloseCircleOutlined />}
              message={`Validation failed — ${result.errors?.length} error(s)`}
              description={
                <List
                  size="small"
                  dataSource={result.errors?.slice(0, 20) || []}
                  renderItem={(err) => <List.Item><Text type="danger" style={{ fontSize: 12 }}>{err}</Text></List.Item>}
                />
              }
              showIcon
            />
          )}

          {result.warnings?.length > 0 && (
            <Alert
              type="warning"
              icon={<WarningOutlined />}
              message={`${result.warnings.length} warning(s)`}
              description={
                <List
                  size="small"
                  dataSource={result.warnings.slice(0, 10)}
                  renderItem={(w) => <List.Item><Text type="warning" style={{ fontSize: 12 }}>{w}</Text></List.Item>}
                />
              }
              showIcon
              style={{ marginTop: 8 }}
            />
          )}
        </div>
      )}

      <Card size="small" title="Import Options">
        <Form layout="vertical" size="small">
          <Form.Item label="Import Strategy">
            <Select
              options={STRATEGIES}
              value={options.importStrategy}
              onChange={(v) => onOptionsChange({ ...options, importStrategy: v })}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item label="Atomic Mode">
            <Select
              options={ATOMIC_MODES}
              value={options.atomicMode}
              onChange={(v) => onOptionsChange({ ...options, atomicMode: v })}
              style={{ width: '100%' }}
            />
          </Form.Item>

          <Form.Item label="Async Import" style={{ marginBottom: 0 }}>
            <Switch
              checked={options.async}
              onChange={(v) => onOptionsChange({ ...options, async: v })}
              checkedChildren="Async"
              unCheckedChildren="Sync"
            />
            <Text type="secondary" style={{ marginLeft: 8, fontSize: 12 }}>
              Use async for large datasets (&gt;500 records)
            </Text>
          </Form.Item>
        </Form>
      </Card>
    </div>
  )
}
