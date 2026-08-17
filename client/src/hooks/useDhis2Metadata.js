import { useState, useCallback } from 'react'
import { useConnection } from '../contexts/ConnectionContext.jsx'
import api from '../services/api.js'

function normalizeOrgUnitsResponse(data) {
  return {
    organisationUnits: data?.organisationUnits || [],
    pager: data?.pager || null,
    cached: Boolean(data?.cached),
  }
}

export function useDhis2Metadata() {
  const { getHeaders } = useConnection()
  const [programs, setPrograms] = useState([])
  const [dataSets, setDataSets] = useState([])
  const [orgUnits, setOrgUnits] = useState([])
  const [trackedEntityTypes, setTrackedEntityTypes] = useState([])
  const [dataElements, setDataElements] = useState([])
  const [orgUnitsPager, setOrgUnitsPager] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchPrograms = useCallback(async (options = {}) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/metadata/programs', {
        headers: getHeaders(),
        params: options.refresh ? { refresh: true } : undefined,
      })
      setPrograms(res.data.programs || [])
      return res.data.programs || []
    } catch (err) {
      setError(err.response?.data?.message || err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const fetchDataSets = useCallback(async (options = {}) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/metadata/dataSets', {
        headers: getHeaders(),
        params: options.refresh ? { refresh: true } : undefined,
      })
      setDataSets(res.data.dataSets || [])
      return res.data.dataSets || []
    } catch (err) {
      setError(err.response?.data?.message || err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const fetchOrgUnits = useCallback(async (options = {}) => {
    const {
      search,
      parentId,
      level,
      page,
      pageSize,
      ids,
      withinUserHierarchy = true,
      refresh = false,
      persist = true,
    } = options

    setLoading(true)
    setError(null)
    try {
      const params = {
        search: search || undefined,
        parentId: parentId || undefined,
        level: level || undefined,
        page: page || undefined,
        pageSize: pageSize || undefined,
        ids: Array.isArray(ids) && ids.length > 0 ? ids.join(',') : undefined,
        withinUserHierarchy,
        refresh: refresh ? true : undefined,
      }

      const res = await api.get('/api/metadata/orgUnits', {
        headers: getHeaders(),
        params,
      })

      const normalized = normalizeOrgUnitsResponse(res.data)
      if (persist) {
        setOrgUnits(normalized.organisationUnits)
        setOrgUnitsPager(normalized.pager)
      }
      return normalized
    } catch (err) {
      setError(err.response?.data?.message || err.message)
      return { organisationUnits: [], pager: null, cached: false }
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const fetchOrgUnitsByIds = useCallback(async (ids = [], options = {}) => {
    if (!Array.isArray(ids) || ids.length === 0) return []
    const response = await fetchOrgUnits({
      ids,
      persist: false,
      refresh: options.refresh === true,
    })
    return response.organisationUnits || []
  }, [fetchOrgUnits])

  const fetchTrackedEntityTypes = useCallback(async (options = {}) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/metadata/trackedEntityTypes', {
        headers: getHeaders(),
        params: options.refresh ? { refresh: true } : undefined,
      })
      setTrackedEntityTypes(res.data.trackedEntityTypes || [])
      return res.data.trackedEntityTypes || []
    } catch (err) {
      setError(err.response?.data?.message || err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const fetchDataElements = useCallback(async (programStage, options = {}) => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/metadata/dataElements', {
        headers: getHeaders(),
        params: {
          programStage: programStage || undefined,
          refresh: options.refresh ? true : undefined,
        },
      })
      const items = res.data.dataElements || []
      setDataElements(items)
      return items
    } catch (err) {
      setError(err.response?.data?.message || err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  return {
    programs,
    dataSets,
    orgUnits,
    orgUnitsPager,
    trackedEntityTypes,
    dataElements,
    loading,
    error,
    fetchPrograms,
    fetchDataSets,
    fetchOrgUnits,
    fetchOrgUnitsByIds,
    fetchTrackedEntityTypes,
    fetchDataElements,
  }
}
