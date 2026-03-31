import React from 'react'
import { Typography, Space } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import ExportDashboard from '../components/export/ExportDashboard.jsx'

const { Title } = Typography

export default function ExportPage() {
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
      <ExportDashboard />
    </div>
  )
}
