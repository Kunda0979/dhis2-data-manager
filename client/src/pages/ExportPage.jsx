import React from 'react'
import { Button, Card, Space, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { DownloadOutlined } from '@ant-design/icons'
import ExportDashboard from '../components/export/ExportDashboard.jsx'

const { Title } = Typography

export default function ExportPage() {
  const navigate = useNavigate()

  return (
    <div>
      <div
        style={{
          marginBottom: 20,
          padding: '16px 20px',
          background: '#fff',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #0369a1, #0ea5e9)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <DownloadOutlined style={{ color: '#fff', fontSize: 16 }} />
        </div>
        <div>
          <Title level={5} style={{ margin: 0 }}>Export Data</Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Select filters and export tracker data from DHIS2
          </Typography.Text>
        </div>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Typography.Text strong>Quick Actions:</Typography.Text>
          <Button onClick={() => navigate('/downloads')}>Download Template</Button>
          <Button onClick={() => navigate('/import')}>Import Completed File</Button>
          <Button onClick={() => navigate('/history')}>View Job History</Button>
        </Space>
      </Card>

      <ExportDashboard />
    </div>
  )
}
