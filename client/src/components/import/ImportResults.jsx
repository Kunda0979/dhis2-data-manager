import React from 'react'
import { Alert, Card, Row, Col, Statistic, List, Typography, Tag } from 'antd'
import { CheckCircleOutlined, CloseCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

export default function ImportResults({ result, error }) {
  if (error) {
    return <Alert type="error" message="Import Failed" description={error} showIcon />
  }

  if (!result) return null

  const stats = result?.result?.stats || result?.stats || {}
  const importSummary = result?.result?.importSummary || {}
  const importCount = importSummary.importCount || stats
  const conflicts = result?.result?.conflicts || importSummary.conflicts || []

  const created = importCount?.created || stats?.created || 0
  const updated = importCount?.updated || stats?.updated || 0
  const ignored = importCount?.ignored || stats?.ignored || 0
  const deleted = importCount?.deleted || stats?.deleted || 0

  const hasErrors = conflicts.length > 0

  return (
    <div>
      <Alert
        type={hasErrors ? 'warning' : 'success'}
        icon={hasErrors ? <CloseCircleOutlined /> : <CheckCircleOutlined />}
        message={hasErrors ? 'Import completed with some errors' : 'Import completed successfully'}
        showIcon
        style={{ marginBottom: 16 }}
      />

      <Row gutter={16} style={{ marginBottom: 16 }}>
        <Col span={6}>
          <Card>
            <Statistic title="Created" value={created} valueStyle={{ color: '#52c41a' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Updated" value={updated} valueStyle={{ color: '#1677ff' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Ignored" value={ignored} valueStyle={{ color: '#faad14' }} />
          </Card>
        </Col>
        <Col span={6}>
          <Card>
            <Statistic title="Deleted" value={deleted} valueStyle={{ color: '#ff4d4f' }} />
          </Card>
        </Col>
      </Row>

      {conflicts.length > 0 && (
        <Card size="small" title={<Text type="danger">Errors / Conflicts ({conflicts.length})</Text>}>
          <List
            size="small"
            dataSource={conflicts.slice(0, 50)}
            renderItem={(conflict, i) => (
              <List.Item key={i}>
                <Text type="danger" style={{ fontSize: 12 }}>
                  {typeof conflict === 'string' ? conflict : JSON.stringify(conflict)}
                </Text>
              </List.Item>
            )}
          />
          {conflicts.length > 50 && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              ... and {conflicts.length - 50} more errors
            </Text>
          )}
        </Card>
      )}
    </div>
  )
}
