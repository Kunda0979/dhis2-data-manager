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
  blocked: 'magenta',
  expired: 'gold',
  EXPIRED: 'gold',
  'expired-output': 'orange',
  ACTIVE: 'blue',
  active: 'blue',
}

const STATUS_LABELS = {
  'expired-output': 'EXPIRED OUTPUT',
}

export default function StatusBadge({ status, label }) {
  const color = STATUS_COLORS[status] || 'default'
  return <Tag color={color}>{label || STATUS_LABELS[status] || status}</Tag>
}
