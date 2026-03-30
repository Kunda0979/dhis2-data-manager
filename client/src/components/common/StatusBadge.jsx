import React from 'react'
import { Tag } from 'antd'

const STATUS_COLORS = {
  success: 'success',
  completed: 'success',
  COMPLETED: 'success',
  failed: 'error',
  error: 'error',
  ERROR: 'error',
  'in-progress': 'processing',
  running: 'processing',
  queued: 'processing',
  cancelled: 'default',
  pending: 'warning',
  warning: 'warning',
  ACTIVE: 'blue',
  active: 'blue',
}

export default function StatusBadge({ status, label }) {
  const color = STATUS_COLORS[status] || 'default'
  return <Tag color={color}>{label || status}</Tag>
}
