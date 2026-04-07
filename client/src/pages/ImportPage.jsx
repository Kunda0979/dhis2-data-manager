import React from 'react'
import { Button, Card, Space, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { UploadOutlined } from '@ant-design/icons'
import ImportDashboard from '../components/import/ImportDashboard.jsx'

const { Title } = Typography

export default function ImportPage() {
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
            background: 'linear-gradient(135deg, #059669, #34d399)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <UploadOutlined style={{ color: '#fff', fontSize: 16 }} />
        </div>
        <div>
          <Title level={5} style={{ margin: 0 }}>Import Data</Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Upload and map files to import data into DHIS2
          </Typography.Text>
        </div>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Typography.Text strong>Quick Actions:</Typography.Text>
          <Button onClick={() => navigate('/downloads')}>Download Template</Button>
          <Button onClick={() => navigate('/export')}>Export Reference Data</Button>
          <Button onClick={() => navigate('/history')}>View Job History</Button>
        </Space>
      </Card>

      <ImportDashboard />
    </div>
  )
}
