import { useState, useCallback } from 'react'
import { useConnection } from '../contexts/ConnectionContext.jsx'
import api from '../services/api.js'

export function useDhis2Metadata() {
  const { getHeaders } = useConnection()
  const [programs, setPrograms] = useState([])
  const [orgUnits, setOrgUnits] = useState([])
  const [trackedEntityTypes, setTrackedEntityTypes] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const fetchPrograms = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/metadata/programs', { headers: getHeaders() })
      setPrograms(res.data.programs || [])
      return res.data.programs || []
    } catch (err) {
      setError(err.response?.data?.message || err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const fetchOrgUnits = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/metadata/orgUnits', { headers: getHeaders() })
      setOrgUnits(res.data.organisationUnits || [])
      return res.data.organisationUnits || []
    } catch (err) {
      setError(err.response?.data?.message || err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  const fetchTrackedEntityTypes = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.get('/api/metadata/trackedEntityTypes', { headers: getHeaders() })
      setTrackedEntityTypes(res.data.trackedEntityTypes || [])
      return res.data.trackedEntityTypes || []
    } catch (err) {
      setError(err.response?.data?.message || err.message)
      return []
    } finally {
      setLoading(false)
    }
  }, [getHeaders])

  return {
    programs,
    orgUnits,
    trackedEntityTypes,
    loading,
    error,
    fetchPrograms,
    fetchOrgUnits,
    fetchTrackedEntityTypes,
  }
}
