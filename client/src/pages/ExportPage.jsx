import React from 'react'
import { Typography } from 'antd'
import ExportDashboard from '../components/export/ExportDashboard.jsx'

const { Title } = Typography

export default function ExportPage() {
  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        Export Data
      </Title>
      <ExportDashboard />
    </div>
  )
}
