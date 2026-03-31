import { useState, useCallback } from 'react'
import { useConnection } from '../contexts/ConnectionContext.jsx'
import api from '../services/api.js'

export function useDhis2Import() {
  const { getHeaders } = useConnection()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [validationResult, setValidationResult] = useState(null)

  const validateFile = useCallback(async (file, dataType, mapping) => {
    setLoading(true)
    setError(null)
    setValidationResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('dataType', dataType)
      if (mapping) formData.append('mapping', JSON.stringify(mapping))

      const res = await api.post('/api/import/validate', formData, {
        headers: { ...getHeaders(), 'Content-Type': 'multipart/form-data' },
      })
      setValidationResult(res.data)
      return res.data
    } catch (err) {
      const msg = err.response?.data?.message || err.message
      setError(msg)
      return null
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const importFile = useCallback(async (file, dataType, mapping, options) => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('dataType', dataType)
      if (mapping) formData.append('mapping', JSON.stringify(mapping))
      if (options?.importStrategy) formData.append('importStrategy', options.importStrategy)
      if (options?.atomicMode) formData.append('atomicMode', options.atomicMode)
      if (options?.async !== undefined) formData.append('async', String(options.async))

      const res = await api.post('/api/import/tracker', formData, {
        headers: { ...getHeaders(), 'Content-Type': 'multipart/form-data' },
      })
      setResult(res.data)
      return res.data
    } catch (err) {
      const errData = err.response?.data
      const msg = errData?.message || errData?.error || err.message
      setError(msg)
      if (errData?.errors) {
        setValidationResult({
          valid: false,
          errors: errData.errors,
          warnings: errData.warnings || [],
          rowIssues: errData.rowIssues,
        })
      }
      return null
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const checkJobStatus = useCallback(async (jobId) => {
    const res = await api.get(`/api/import/jobs/${jobId}`, { headers: getHeaders() })
    return res.data
  }, [getHeaders])

  const downloadTemplate = useCallback(async (options = {}) => {
    const {
      dataType = 'events',
      variant = 'empty',
      format = 'csv',
      programId,
      programStageId,
    } = options
    const query = { dataType, variant, format }
    if (programId) query.programId = programId
    if (programStageId) query.programStageId = programStageId
    const params = new URLSearchParams(query).toString()
    const res = await api.get(`/api/import/template?${params}`, {
      headers: getHeaders(),
      responseType: 'blob',
    })

    const contentDisposition = res.headers['content-disposition'] || ''
    const filenameMatch = contentDisposition.match(/filename="(.+)"/)
    const filename = filenameMatch ? filenameMatch[1] : `template-${dataType}-${variant}.${format}`

    const blob = new Blob([res.data])
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = filename
    link.click()
    URL.revokeObjectURL(link.href)
  }, [getHeaders])

  const previewTemplate = useCallback(async (options = {}) => {
    const {
      dataType = 'events',
      variant = 'empty',
      programId,
      programStageId,
    } = options
    const query = { dataType, variant }
    if (programId) query.programId = programId
    if (programStageId) query.programStageId = programStageId
    const params = new URLSearchParams(query).toString()
    const res = await api.get(`/api/import/template/preview?${params}`, {
      headers: getHeaders(),
    })
    return res.data
  }, [getHeaders])

  return {
    loading,
    error,
    result,
    validationResult,
    validateFile,
    importFile,
    checkJobStatus,
    downloadTemplate,
    previewTemplate,
  }
}
