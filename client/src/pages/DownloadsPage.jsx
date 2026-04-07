import React from 'react'
import { Button, Card, Space, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { FileTextOutlined } from '@ant-design/icons'
import DownloadsDashboard from '../components/downloads/DownloadsDashboard.jsx'

const { Title } = Typography

export default function DownloadsPage() {
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
            background: 'linear-gradient(135deg, #0f766e, #14b8a6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <FileTextOutlined style={{ color: '#fff', fontSize: 16 }} />
        </div>
        <div>
          <Title level={5} style={{ margin: 0 }}>Download Templates</Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Download program-based templates, complete them offline, and import them back into DHIS2
          </Typography.Text>
        </div>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Typography.Text strong>Quick Actions:</Typography.Text>
          <Button onClick={() => navigate('/export')}>Export Data</Button>
          <Button onClick={() => navigate('/import')}>Import Completed Template</Button>
          <Button onClick={() => navigate('/history')}>View Job History</Button>
        </Space>
      </Card>

      <DownloadsDashboard />
    </div>
  )
}
