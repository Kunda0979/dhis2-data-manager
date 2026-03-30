import React, { useMemo } from 'react'
import { Select, Form, Space, Tag } from 'antd'

const OU_MODE_OPTIONS = [
  { value: 'SELECTED', label: 'Selected only' },
  { value: 'CHILDREN', label: 'Include children' },
  { value: 'DESCENDANTS', label: 'All descendants' },
  { value: 'ACCESSIBLE', label: 'Accessible' },
  { value: 'CAPTURE', label: 'Capture scope' },
  { value: 'ALL', label: 'All org units' },
]

export default function OrgUnitSelector({ orgUnits = [], value, onChange, ouMode, onOuModeChange }) {
  const options = useMemo(
    () =>
      orgUnits.map((ou) => ({
        value: ou.id,
        label: `${'— '.repeat((ou.level || 1) - 1)}${ou.displayName}`,
        level: ou.level,
      })),
    [orgUnits]
  )

  return (
    <div>
      <Form.Item label="Organisation Unit" style={{ marginBottom: 8 }} required>
        <Select
          showSearch
          allowClear
          placeholder="Select organisation unit"
          options={options}
          value={value}
          onChange={onChange}
          filterOption={(input, option) =>
            option?.label?.toLowerCase().includes(input.toLowerCase())
          }
        />
      </Form.Item>
      <Form.Item label="OU Mode" style={{ marginBottom: 12 }}>
        <Select
          options={OU_MODE_OPTIONS}
          value={ouMode}
          onChange={onOuModeChange}
        />
      </Form.Item>
    </div>
  )
}
