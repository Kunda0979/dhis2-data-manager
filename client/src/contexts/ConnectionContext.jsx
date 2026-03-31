import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import api from '../services/api.js'

const ConnectionContext = createContext(null)
const SESSION_TOKEN_KEY = 'dhis2_session_token'

export function ConnectionProvider({ children }) {
  const [sessionToken, setSessionToken] = useState(() => sessionStorage.getItem(SESSION_TOKEN_KEY) || '')
  const [profiles, setProfiles] = useState([])
  const [connection, setConnection] = useState(null) // { url, username, user, serverInfo, id }
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState(null)
  // True while the initial session-restore call is in-flight
  const [restoringSession, setRestoringSession] = useState(() => !!sessionStorage.getItem(SESSION_TOKEN_KEY))
  const sessionExpiredHandlerRef = useRef(null)

  const clearSession = useCallback(() => {
    setSessionToken('')
    setProfiles([])
    setConnection(null)
    setConnectionError(null)
    setRestoringSession(false)
    sessionStorage.removeItem(SESSION_TOKEN_KEY)
  }, [])

  const authHeaders = useCallback((token = sessionToken) => {
    if (!token) return {}
    return { Authorization: `Bearer ${token}` }
  }, [sessionToken])

  const applySessionResponse = useCallback((payload) => {
    const token = payload?.sessionToken || payload?.token || sessionToken
    const allProfiles = payload?.profiles || []
    const activeId = payload?.activeProfileId
    const activeProfile = payload?.activeProfile || allProfiles.find((p) => p.id === activeId) || null

    if (token) {
      setSessionToken(token)
      sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    }

    setProfiles(allProfiles)
    if (activeProfile) {
      setConnection(activeProfile)
    }
  }, [sessionToken])

  const refreshProfiles = useCallback(async (token = sessionToken) => {
    if (!token) return null
    try {
      const response = await api.get('/api/connect/profiles', {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      applySessionResponse(response.data)
      return response.data
    } catch {
      clearSession()
      return null
    }
  }, [applySessionResponse, clearSession, sessionToken])

  const connect = useCallback(async (url, username, password, profileName) => {
    setConnecting(true)
    setConnectionError(null)
    try {
      const response = await api.post(
        '/api/connect',
        { url, username, password, profileName },
        { headers: authHeaders() },
      )
      const { user, serverInfo } = response.data
      applySessionResponse(response.data)
      return { success: true, user, serverInfo }
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Connection failed'
      setConnectionError(message)
      return { success: false, error: message }
    } finally {
      setConnecting(false)
    }
  }, [applySessionResponse, authHeaders])

  const switchProfile = useCallback(async (profileId) => {
    if (!sessionToken) return { success: false, error: 'No active session' }
    try {
      const res = await api.post('/api/connect/profiles/switch', { profileId }, { headers: authHeaders() })
      applySessionResponse(res.data)
      return { success: true }
    } catch (err) {
      const message = err.response?.data?.error || err.message
      setConnectionError(message)
      return { success: false, error: message }
    }
  }, [applySessionResponse, authHeaders, sessionToken])

  const removeProfile = useCallback(async (profileId) => {
    if (!sessionToken) return { success: false, error: 'No active session' }
    try {
      const res = await api.delete(`/api/connect/profiles/${profileId}`, { headers: authHeaders() })
      applySessionResponse(res.data)
      return { success: true }
    } catch (err) {
      const message = err.response?.data?.error || err.message
      setConnectionError(message)
      return { success: false, error: message }
    }
  }, [applySessionResponse, authHeaders, sessionToken])

  const disconnect = useCallback(() => {
    if (sessionToken) {
      api.post('/api/connect/disconnect', {}, { headers: authHeaders() }).catch(() => undefined)
    }
    clearSession()
  }, [authHeaders, clearSession, sessionToken])

  const getHeaders = useCallback(() => {
    return authHeaders()
  }, [authHeaders])

  // On mount: if a token was stored, restore the session once.
  React.useEffect(() => {
    const storedToken = sessionStorage.getItem(SESSION_TOKEN_KEY)
    if (!storedToken) return
    refreshProfiles(storedToken).finally(() => setRestoringSession(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run once on mount

  // Listen for any 401 from the axios interceptor and clear the session.
  React.useEffect(() => {
    sessionExpiredHandlerRef.current = () => clearSession()
    const handler = () => sessionExpiredHandlerRef.current?.()
    window.addEventListener('dhis2:session-expired', handler)
    return () => window.removeEventListener('dhis2:session-expired', handler)
  }, [clearSession])

  return (
    <ConnectionContext.Provider
      value={{
        sessionToken,
        connection,
        profiles,
        connecting,
        connectionError,
        restoringSession,
        isConnected: !!sessionToken && !!connection,
        connect,
        switchProfile,
        removeProfile,
        refreshProfiles,
        disconnect,
        getHeaders,
      }}
    >
      {children}
    </ConnectionContext.Provider>
  )
}

export function useConnection() {
  const ctx = useContext(ConnectionContext)
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider')
  return ctx
}
