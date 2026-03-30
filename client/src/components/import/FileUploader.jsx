import React from 'react'
import { Upload, Typography, Space } from 'antd'
import { InboxOutlined } from '@ant-design/icons'

const { Dragger } = Upload
const { Text, Title } = Typography

export default function FileUploader({ onFileSelect }) {
  const beforeUpload = (file) => {
    onFileSelect(file)
    return false // prevent auto upload
  }

  return (
    <div>
      <Dragger
        accept=".json,.csv,.xlsx,.xls"
        beforeUpload={beforeUpload}
        maxCount={1}
        showUploadList={false}
        style={{ padding: '32px 0' }}
      >
        <p className="ant-upload-drag-icon">
          <InboxOutlined style={{ fontSize: 48, color: '#1677ff' }} />
        </p>
        <Title level={4} style={{ marginBottom: 4 }}>
          Drag & drop a file here
        </Title>
        <Text type="secondary">
          or click to browse your files
        </Text>
        <div style={{ marginTop: 8 }}>
          <Space>
            <Text type="secondary" style={{ fontSize: 12 }}>Supported formats:</Text>
            <Text code style={{ fontSize: 12 }}>.json</Text>
            <Text code style={{ fontSize: 12 }}>.csv</Text>
            <Text code style={{ fontSize: 12 }}>.xlsx</Text>
            <Text code style={{ fontSize: 12 }}>.xls</Text>
          </Space>
        </div>
      </Dragger>
    </div>
  )
}
