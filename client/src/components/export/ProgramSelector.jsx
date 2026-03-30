import React from 'react'
import { Select, Form } from 'antd'

export default function ProgramSelector({ programs = [], value, onChange }) {
  const options = programs.map((p) => ({
    value: p.id,
    label: `${p.displayName} (${p.programType})`,
  }))

  return (
    <Form.Item label="Program" style={{ marginBottom: 12 }}>
      <Select
        showSearch
        allowClear
        placeholder="Select a program (optional)"
        options={options}
        value={value}
        onChange={onChange}
        filterOption={(input, option) =>
          option?.label?.toLowerCase().includes(input.toLowerCase())
        }
      />
    </Form.Item>
  )
}
