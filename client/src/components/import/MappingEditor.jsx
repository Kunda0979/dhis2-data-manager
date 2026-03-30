import React from 'react'
import { Table, Select, Typography, Alert, Tag, Button, Space } from 'antd'

const { Text } = Typography

// DHIS2 tracker field suggestions by data type
const DHIS2_FIELDS = {
  events: ['event', 'status', 'program', 'programStage', 'orgUnit', 'occurredAt', 'scheduledAt', 'enrollment', 'trackedEntity'],
  enrollments: ['enrollment', 'trackedEntity', 'program', 'orgUnit', 'enrolledAt', 'occurredAt', 'status'],
  trackedEntities: ['trackedEntity', 'trackedEntityType', 'orgUnit'],
}

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

function scoreCandidate(column, candidate) {
  const col = normalize(column)
  const key = normalize(candidate.value)
  const label = normalize(candidate.label)

  if (!col || !key) return 0
  if (col === key || col === label) return 1
  if (col.includes(key) || key.includes(col)) return 0.85
  if (label.includes(col) || col.includes(label)) return 0.8

  const colTokens = new Set(String(column).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  const labelTokens = new Set(String(candidate.label || candidate.value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  let overlap = 0
  for (const token of colTokens) {
    if (labelTokens.has(token)) overlap += 1
  }

  if (colTokens.size === 0) return 0
  return Math.min(0.75, overlap / colTokens.size)
}

function buildSuggestions(columns, candidates) {
  const result = {}
  for (const col of columns) {
    let best = null
    for (const candidate of candidates) {
      const score = scoreCandidate(col, candidate)
      if (!best || score > best.score) {
        best = { field: candidate.value, score }
      }
    }
    if (best && best.score >= 0.55) {
      result[col] = best
    }
  }
  return result
}

function applyFieldMapping(prevMapping, column, field) {
  const next = Object.fromEntries(Object.entries(prevMapping).filter(([key, value]) => key !== field && value !== column))
  if (field) next[field] = column
  return next
}

function invertMapping(mapping) {
  const inverse = {}
  Object.entries(mapping || {}).forEach(([field, column]) => {
    inverse[column] = field
  })
  return inverse
}

export default function MappingEditor({ columns = [], dataType, mapping, onChange, metadataCandidates = [] }) {
  const dhis2Fields = DHIS2_FIELDS[dataType] || []
  const fieldOptions = [
    { value: '', label: '— Skip —' },
    ...dhis2Fields.map((f) => ({ value: f, label: f })),
    ...metadataCandidates,
  ]

  const tableData = columns.map((col) => ({ col, key: col }))
  const inverse = invertMapping(mapping)
  const suggestions = buildSuggestions(columns, fieldOptions.filter((item) => item.value))

  const applyAutoMapping = () => {
    let next = { ...mapping }
    for (const col of columns) {
      const suggestion = suggestions[col]
      if (suggestion) {
        next = applyFieldMapping(next, col, suggestion.field)
      }
    }
    onChange(next)
  }

  const handleMappingChange = (col, dhis2Field) => {
    const next = applyFieldMapping(mapping, col, dhis2Field)
    onChange(next)
  }

  const columns_def = [
    {
      title: 'File Column',
      dataIndex: 'col',
      key: 'col',
      render: (v) => <Text code style={{ fontSize: 12 }}>{v}</Text>,
    },
    {
      title: 'Maps to DHIS2 Field',
      dataIndex: 'col',
      key: 'mapping',
      render: (col) => {
        const currentMapping = inverse[col] || ''
        return (
          <Select
            size="small"
            style={{ width: 220 }}
            options={fieldOptions}
            value={currentMapping}
            onChange={(val) => handleMappingChange(col, val)}
            placeholder="Auto-detect"
            allowClear
          />
        )
      },
    },
    {
      title: 'Status',
      dataIndex: 'col',
      key: 'status',
      render: (col) => {
        const isMapped = Object.values(mapping).includes(col)
        const suggested = suggestions[col]
        if (isMapped) return <Tag color="success">Mapped</Tag>
        if (!suggested) return <Tag>Unmapped</Tag>
        const confidence = suggested.score >= 0.85 ? 'High' : suggested.score >= 0.7 ? 'Medium' : 'Low'
        return <Tag color={confidence === 'High' ? 'blue' : 'gold'}>{confidence} confidence</Tag>
      },
    },
  ]

  return (
    <div>
      <Alert
        type="info"
        message="Column Mapping"
        description={`Map your file's columns to DHIS2 ${dataType} fields. Unmapped columns are auto-detected by name.`}
        showIcon
        style={{ marginBottom: 16 }}
      />
      <Space style={{ marginBottom: 12 }}>
        <Button size="small" onClick={applyAutoMapping}>Apply Smart Auto-Mapping</Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          Uses field names plus metadata labels to suggest best matches.
        </Text>
      </Space>
      <Table
        dataSource={tableData}
        columns={columns_def}
        size="small"
        pagination={false}
        rowKey="key"
      />
    </div>
  )
}
