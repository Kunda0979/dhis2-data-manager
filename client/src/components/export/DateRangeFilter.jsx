import React from 'react'
import { DatePicker, Form, Space } from 'antd'
import dayjs from 'dayjs'

export default function DateRangeFilter({ startDate, endDate, onChange }) {
  return (
    <div>
      <Form.Item label="Date Range" style={{ marginBottom: 12 }}>
        <Space direction="vertical" style={{ width: '100%' }}>
          <DatePicker
            placeholder="Start date"
            style={{ width: '100%' }}
            value={startDate ? dayjs(startDate) : null}
            onChange={(_, dateStr) => onChange(dateStr || undefined, endDate)}
          />
          <DatePicker
            placeholder="End date"
            style={{ width: '100%' }}
            value={endDate ? dayjs(endDate) : null}
            onChange={(_, dateStr) => onChange(startDate, dateStr || undefined)}
            disabledDate={(current) => startDate && current < dayjs(startDate)}
          />
        </Space>
      </Form.Item>
    </div>
  )
}
