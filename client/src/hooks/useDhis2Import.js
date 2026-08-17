import { useState, useCallback } from 'react'
import { useConnection } from '../contexts/ConnectionContext.jsx'
import api from '../services/api.js'
import { normalizeApiError } from '../utils/apiError.js'

export function useDhis2Import() {
  const { getHeaders } = useConnection()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [result, setResult] = useState(null)
  const [validationResult, setValidationResult] = useState(null)

  const validateFile = useCallback(async (file, dataType, mapping = null, options = {}) => {
    setLoading(true)
    setError(null)
    setValidationResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('dataType', dataType)
      if (mapping && Object.keys(mapping).length > 0) formData.append('mapping', JSON.stringify(mapping))
      if (options?.importStrategy) formData.append('importStrategy', options.importStrategy)
      if (options?.atomicMode) formData.append('atomicMode', options.atomicMode)
      if (options?.async !== undefined) formData.append('async', String(options.async))
      if (options?.markComplete !== undefined) formData.append('markComplete', String(options.markComplete))
      if (options?.completionDate) formData.append('completionDate', options.completionDate)
      if (options?.submissionComment) formData.append('submissionComment', options.submissionComment)
      if (options?.programId) formData.append('programId', options.programId)
      if (options?.dataSetId) formData.append('dataSetId', options.dataSetId)
      if (options?.dataSet) formData.append('dataSet', options.dataSet)
      if (options?.period) formData.append('period', options.period)
      if (options?.orgUnit) formData.append('orgUnit', options.orgUnit)
      if (options?.attributeOptionCombo) formData.append('attributeOptionCombo', options.attributeOptionCombo)

      const res = await api.post('/api/import/validate', formData, {
        headers: { ...getHeaders(), 'Content-Type': 'multipart/form-data' },
      })
      setValidationResult(res.data)
      return res.data
    } catch (err) {
      const errData = err.response?.data || {}
      const normalized = normalizeApiError(err)
      setError(normalized)

      const normalizeList = (value) => {
        if (Array.isArray(value)) return value
        if (value === null || value === undefined || value === '') return []
        return [value]
      }

      const toStructuredError = (messageText, fallbackField = '') => {
        const details = errData?.error?.details && typeof errData.error.details === 'object'
          ? errData.error.details
          : {}

        const orgUnitName = details.orgUnitName || details.orgUnit || ''
        const orgUnitId = details.orgUnitId || ''
        const dataElementName = details.dataElementName || ''
        const dataElement = details.dataElement || ''

        return {
          severity: 'error',
          row: details.row || '',
          field: details.field || fallbackField,
          column: details.column || '',
          message: messageText,
          orgUnit: orgUnitName || orgUnitId || '',
          orgUnitName,
          orgUnitId,
          dataElement,
          dataElementName,
          period: details.period || '',
          value: details.value ?? '',
        }
      }

      const derivedErrors = (() => {
        const explicitErrors = normalizeList(errData.errors)
        if (explicitErrors.length > 0) return explicitErrors

        const msg = normalized.message || 'Dry run failed'
        if (errData?.error?.details && typeof errData.error.details === 'object') {
          return [toStructuredError(msg)]
        }

        return [msg]
      })()

      const fallbackResult = {
        valid: false,
        errors: derivedErrors,
        warnings: normalizeList(errData.warnings),
        rowIssues: {
          errors: normalizeList(errData?.rowIssues?.errors),
          warnings: normalizeList(errData?.rowIssues?.warnings),
        },
        compatibility: errData.compatibility || undefined,
        aggregateValidation: errData.aggregateValidation || undefined,
        completionPolicy: errData.completionPolicy || undefined,
        templateMismatch: errData.code && String(errData.code).includes('MISMATCH')
          ? {
            code: errData.code,
            uploadedDatasetId: errData.uploadedDatasetId || null,
            uploadedDatasetName: errData.uploadedDatasetName || null,
            selectedDatasetId: errData.selectedDatasetId || null,
            uploadedProgramId: errData.uploadedProgramId || null,
            uploadedProgramName: errData.uploadedProgramName || null,
            selectedProgramId: errData.selectedProgramId || null,
            mismatchWarnings: errData.mismatchWarnings || [],
          }
          : undefined,
        validationToken: null,
      }
      setValidationResult(fallbackResult)
      return fallbackResult
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const importFile = useCallback(async (file, dataType, mapping = null, options = {}) => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('dataType', dataType)
      if (mapping && Object.keys(mapping).length > 0) formData.append('mapping', JSON.stringify(mapping))
      if (options?.importStrategy) formData.append('importStrategy', options.importStrategy)
      if (options?.atomicMode) formData.append('atomicMode', options.atomicMode)
      if (options?.async !== undefined) formData.append('async', String(options.async))
      if (options?.validationToken) formData.append('validationToken', options.validationToken)
      if (options?.markComplete !== undefined) formData.append('markComplete', String(options.markComplete))
      if (options?.completionDate) formData.append('completionDate', options.completionDate)
      if (options?.submissionComment) formData.append('submissionComment', options.submissionComment)
      if (options?.programId) formData.append('programId', options.programId)
      if (options?.dataSetId) formData.append('dataSetId', options.dataSetId)
      if (options?.dataSet) formData.append('dataSet', options.dataSet)
      if (options?.period) formData.append('period', options.period)
      if (options?.orgUnit) formData.append('orgUnit', options.orgUnit)
      if (options?.attributeOptionCombo) formData.append('attributeOptionCombo', options.attributeOptionCombo)

      const res = await api.post('/api/import/tracker', formData, {
        headers: { ...getHeaders(), 'Content-Type': 'multipart/form-data' },
      })
      setResult(res.data)
      return res.data
    } catch (err) {
      const errData = err.response?.data
      const normalized = normalizeApiError(err)
      const gateReason = errData?.validationGate?.reason
      let gateHint = ''
      if (gateReason === 'missing-token') {
        gateHint = 'Run Dry Run first, then import using that validation result.'
      } else if (gateReason === 'unknown-token' || gateReason === 'expired-token' || gateReason === 'session-mismatch') {
        gateHint = 'Your previous Dry Run session is no longer valid. Run Dry Run again and retry import.'
      } else if (gateReason === 'fingerprint-mismatch') {
        gateHint = 'File or critical import settings changed after Dry Run. Run Dry Run again before importing.'
      }

      const enriched = {
        ...normalized,
        message: gateReason ? 'Import blocked by validation gate' : normalized.message,
        hint: gateHint || normalized.hint,
        validationGate: errData?.validationGate || null,
        importReport: errData?.importReport || errData?.result?.importReport || null,
        result: errData?.result || null,
      }
      setError(enriched)
      if (errData?.errors) {
        setValidationResult({
          valid: false,
          errors: errData.errors,
          warnings: errData.warnings || [],
          rowIssues: errData.rowIssues,
        })
      }
      return { failed: true, error: enriched }
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const checkJobStatus = useCallback(async (jobId) => {
    const res = await api.get(`/api/import/jobs/${jobId}`, { headers: getHeaders() })
    return res.data
  }, [getHeaders])

  const runAggregateCompletionAction = useCallback(async (payload) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.post('/api/import/aggregate/completion', payload, {
        headers: getHeaders(),
      })
      return res.data
    } catch (err) {
      const normalized = normalizeApiError(err)
      setError(normalized)
      throw normalized
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const downloadTemplate = useCallback(async (options = {}) => {
    const {
      dataType = 'events',
      variant = 'empty',
      format = 'csv',
      programId,
      dataSetId,
      period,
      periodFrequency,
      startPeriod,
      endPeriod,
      programStageId,
      orgUnitScope,
      orgUnitIds,
      language,
      layout,
    } = options
    const query = { dataType, variant, format }
    if (programId) query.programId = programId
    if (dataSetId) query.dataSetId = dataSetId
    if (period) query.period = period
    if (periodFrequency) query.periodFrequency = periodFrequency
    if (startPeriod) query.startPeriod = startPeriod
    if (endPeriod) query.endPeriod = endPeriod
    if (programStageId) query.programStageId = programStageId
    if (orgUnitScope) query.orgUnitScope = orgUnitScope
    if (Array.isArray(orgUnitIds) && orgUnitIds.length > 0) query.orgUnitIds = orgUnitIds.join(',')
    if (language) query.language = language
    if (layout) query.layout = layout
    try {
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
    } catch (err) {
      const normalized = normalizeApiError(err)
      setError(normalized)
      throw normalized
    }
  }, [getHeaders])

  const previewTemplate = useCallback(async (options = {}) => {
    const {
      dataType = 'events',
      variant = 'empty',
      programId,
      dataSetId,
      period,
      periodFrequency,
      startPeriod,
      endPeriod,
      programStageId,
    } = options
    const query = { dataType, variant }
    if (programId) query.programId = programId
    if (dataSetId) query.dataSetId = dataSetId
    if (period) query.period = period
    if (periodFrequency) query.periodFrequency = periodFrequency
    if (startPeriod) query.startPeriod = startPeriod
    if (endPeriod) query.endPeriod = endPeriod
    if (programStageId) query.programStageId = programStageId
    try {
      const params = new URLSearchParams(query).toString()
      const res = await api.get(`/api/import/template/preview?${params}`, {
        headers: getHeaders(),
      })
      return res.data
    } catch (err) {
      const normalized = normalizeApiError(err)
      setError(normalized)
      throw normalized
    }
  }, [getHeaders])

  return {
    loading,
    error,
    result,
    validationResult,
    validateFile,
    importFile,
    checkJobStatus,
    runAggregateCompletionAction,
    downloadTemplate,
    previewTemplate,
  }
}
