import React from 'react'
import { Typography } from 'antd'
import { FileTextOutlined } from '@ant-design/icons'
import DownloadsDashboard from '../components/downloads/DownloadsDashboard.jsx'

const { Title } = Typography

export default function DownloadsPage() {
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
      <DownloadsDashboard />
    </div>
  )
}
