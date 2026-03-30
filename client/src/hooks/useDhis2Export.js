import { useState, useCallback } from 'react'
import { useConnection } from '../contexts/ConnectionContext.jsx'
import api from '../services/api.js'

export function useDhis2Export() {
  const { getHeaders } = useConnection()
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [count, setCount] = useState(0)

  const exportData = useCallback(async (dataType, params) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get(`/api/export/${dataType}`, {
        headers: getHeaders(),
        params: { ...params, format: 'json' },
      })
      const items = res.data.data || []
      setData(items)
      setCount(res.data.count || items.length)
      return items
    } catch (err) {
      const msg = err.response?.data?.message || err.message
      setError(msg)
      return []
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const downloadFile = useCallback(async (dataType, params, format) => {
    const headers = getHeaders()
    const queryParams = new URLSearchParams({ ...params, format }).toString()
    const url = `/api/export/${dataType}?${queryParams}`

    const res = await api.get(url, {
      headers,
      responseType: 'blob',
    })

    const contentDisposition = res.headers['content-disposition'] || ''
    const filenameMatch = contentDisposition.match(/filename="(.+)"/)
    const filename = filenameMatch ? filenameMatch[1] : `${dataType}-export.${format}`

    const blob = new Blob([res.data])
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  }, [getHeaders])

  return { data, loading, error, count, exportData, downloadFile }
}
