import React, { useState } from 'react'
import { Card, Form, Select, Button, Space, Typography } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { useDhis2Import } from '../../hooks/useDhis2Import.js'

const DATA_TYPES = [
  { value: 'events', label: 'Events' },
  { value: 'enrollments', label: 'Enrollments' },
  { value: 'trackedEntities', label: 'Tracked Entities' },
]

const TEMPLATE_VARIANTS = [
  { value: 'empty', label: 'Empty Template' },
  { value: 'prepopulated', label: 'Pre-populated Template' },
]

const FORMATS = [
  { value: 'csv', label: 'CSV' },
  { value: 'json', label: 'JSON' },
  { value: 'xlsx', label: 'Excel (.xlsx)' },
]

export default function TemplateDownloadPanel() {
  const { downloadTemplate } = useDhis2Import()
  const [dataType, setDataType] = useState('events')
  const [variant, setVariant] = useState('empty')
  const [format, setFormat] = useState('csv')
  const [downloading, setDownloading] = useState(false)

  const handleDownload = async () => {
    setDownloading(true)
    try {
      await downloadTemplate(dataType, variant, format)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Card size="small" title="Download Import Templates" style={{ marginBottom: 16 }}>
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Choose a template type and format. Empty templates include only headers; pre-populated templates include sample values.
        </Typography.Text>

        <Form layout="inline" style={{ rowGap: 8 }}>
          <Form.Item label="Data Type">
            <Select value={dataType} onChange={setDataType} options={DATA_TYPES} style={{ width: 170 }} />
          </Form.Item>
          <Form.Item label="Template">
            <Select value={variant} onChange={setVariant} options={TEMPLATE_VARIANTS} style={{ width: 220 }} />
          </Form.Item>
          <Form.Item label="Format">
            <Select value={format} onChange={setFormat} options={FORMATS} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownload} loading={downloading}>
              Download
            </Button>
          </Form.Item>
        </Form>
      </Space>
    </Card>
  )
}
