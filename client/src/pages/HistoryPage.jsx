import React from 'react'
import { Typography, Card } from 'antd'
import { HistoryOutlined } from '@ant-design/icons'
import JobHistory from '../components/history/JobHistory.jsx'

const { Title } = Typography

export default function HistoryPage() {
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
            background: 'linear-gradient(135deg, #7c3aed, #a78bfa)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <HistoryOutlined style={{ color: '#fff', fontSize: 16 }} />
        </div>
        <div>
          <Title level={5} style={{ margin: 0 }}>Job History</Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Track past export and import operations
          </Typography.Text>
        </div>
      </div>
      <Card>
        <JobHistory />
      </Card>
    </div>
  )
}
