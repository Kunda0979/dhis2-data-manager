import React from 'react'
import { Alert } from 'antd'

export default function ErrorAlert({ message, description, onClose }) {
  return (
    <Alert
      type="error"
      message={message || 'Error'}
      description={description}
      showIcon
      closable={!!onClose}
      onClose={onClose}
      style={{ marginBottom: 16 }}
    />
  )
}
