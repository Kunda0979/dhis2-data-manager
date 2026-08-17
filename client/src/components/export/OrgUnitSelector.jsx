import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Form, Select, Space } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'

const OU_MODE_OPTIONS = [
  { value: 'SELECTED', label: 'Selected only' },
  { value: 'CHILDREN', label: 'Include children' },
  { value: 'DESCENDANTS', label: 'All descendants' },
  { value: 'ACCESSIBLE', label: 'Accessible' },
  { value: 'CAPTURE', label: 'Capture scope' },
  { value: 'ALL', label: 'All org units' },
]

function toOption(ou) {
  return {
    value: ou.id,
    label: `${'— '.repeat(Math.max((ou.level || 1) - 1, 0))}${ou.displayName}`,
    level: ou.level,
    parentId: ou.parent?.id || null,
  }
}

export default function OrgUnitSelector({ value, onChange, ouMode, onOuModeChange, fetchOrgUnits, fetchOrgUnitsByIds }) {
  const [options, setOptions] = useState([])
  const [loading, setLoading] = useState(false)
  const [searchValue, setSearchValue] = useState('')
  const searchTimerRef = useRef(null)

  const loadRootUnits = async ({ refresh = false } = {}) => {
    if (!fetchOrgUnits) return
    setLoading(true)
    try {
      const response = await fetchOrgUnits({
        level: 1,
        page: 1,
        pageSize: 100,
        withinUserHierarchy: true,
        persist: false,
        refresh,
      })
      setOptions((response.organisationUnits || []).map(toOption))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadRootUnits()
  }, [])

  useEffect(() => () => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!value || !fetchOrgUnitsByIds) return
    const exists = options.some((item) => item.value === value)
    if (exists) return

    let cancelled = false
    const hydrateSelected = async () => {
      const selected = await fetchOrgUnitsByIds([value])
      if (cancelled || selected.length === 0) return
      setOptions((current) => {
        const next = [...current]
        const known = new Set(next.map((item) => item.value))
        for (const ou of selected) {
          if (!known.has(ou.id)) {
            next.push(toOption(ou))
            known.add(ou.id)
          }
        }
        return next
      })
    }

    hydrateSelected()
    return () => {
      cancelled = true
    }
  }, [fetchOrgUnitsByIds, options, value])

  const handleSearch = (input) => {
    setSearchValue(input)
    if (!fetchOrgUnits) return
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current)
    }

    searchTimerRef.current = setTimeout(async () => {
      setLoading(true)
      try {
        const response = input
          ? await fetchOrgUnits({
            search: input,
            page: 1,
            pageSize: 50,
            withinUserHierarchy: true,
            persist: false,
          })
          : await fetchOrgUnits({
            level: 1,
            page: 1,
            pageSize: 100,
            withinUserHierarchy: true,
            persist: false,
          })

        setOptions((response.organisationUnits || []).map(toOption))
      } finally {
        setLoading(false)
      }
    }, 250)
  }

  const loadChildrenForParent = async (parentId) => {
    if (!parentId || !fetchOrgUnits) return
    setLoading(true)
    try {
      const response = await fetchOrgUnits({
        parentId,
        page: 1,
        pageSize: 150,
        withinUserHierarchy: true,
        persist: false,
      })
      const children = (response.organisationUnits || []).map(toOption)
      if (children.length === 0) return
      setOptions((current) => {
        const next = [...current]
        const known = new Set(next.map((item) => item.value))
        for (const child of children) {
          if (!known.has(child.value)) {
            next.push(child)
            known.add(child.value)
          }
        }
        return next
      })
    } finally {
      setLoading(false)
    }
  }

  const renderedOptions = useMemo(() => options, [options])

  return (
    <div>
      <Form.Item label="Organisation Unit" style={{ marginBottom: 8 }} required>
        <Space.Compact style={{ width: '100%' }}>
          <Select
            showSearch
            allowClear
            placeholder="Search and select organisation unit"
            options={renderedOptions}
            value={value}
            onChange={(nextValue) => {
              onChange(nextValue)
              loadChildrenForParent(nextValue)
            }}
            onSearch={handleSearch}
            searchValue={searchValue}
            onDropdownVisibleChange={(open) => {
              if (open && options.length === 0) {
                loadRootUnits()
              }
            }}
            filterOption={false}
            loading={loading}
            style={{ width: '100%' }}
            notFoundContent={searchValue ? 'No matching organisation units' : 'No organisation units available'}
          />
          <Button
            icon={<ReloadOutlined />}
            onClick={() => loadRootUnits({ refresh: true })}
            title="Refresh organisation units"
          />
        </Space.Compact>
        {value && (
          <Button
            size="small"
            style={{ marginTop: 8 }}
            onClick={() => loadChildrenForParent(value)}
          >
            Load children of selected OU
          </Button>
        )}
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
