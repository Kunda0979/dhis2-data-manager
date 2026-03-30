import React from 'react'
import { Typography } from 'antd'
import ImportDashboard from '../components/import/ImportDashboard.jsx'

const { Title } = Typography

export default function ImportPage() {
  return (
    <div>
      <Title level={4} style={{ marginBottom: 16 }}>
        Import Data
      </Title>
      <ImportDashboard />
    </div>
  )
}
