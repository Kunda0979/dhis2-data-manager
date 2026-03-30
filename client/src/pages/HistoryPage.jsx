import React from 'react'
import { Typography, Card } from 'antd'
import JobHistory from '../components/history/JobHistory.jsx'

const { Title } = Typography

export default function HistoryPage() {
  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        Job History
      </Title>
      <Card>
        <JobHistory />
      </Card>
    </div>
  )
}
