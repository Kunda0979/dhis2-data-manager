import React, { createContext, useContext, useState, useCallback, useRef } from 'react'
import api from '../services/api.js'
import { classifyEnvironment } from '../utils/instanceEnvironment.js'

const ConnectionContext = createContext(null)

// Non-sensitive display info stored in sessionStorage for fast re-hydration.
// The actual session token lives only in the HttpOnly cookie (invisible to JS).
const CONNECTION_CACHE_KEY = 'dhis2_connection_info'
const SESSION_TOKEN_KEY = 'dhis2_session_token'

/**
 * Returns the DHIS2 runtime base URL when running inside DHIS2 App Management.
 * DHIS2 injects window.dhis2.config.baseUrl into every installed app.
 */
function getDhis2RuntimeBaseUrl() {
  try {
    return window.dhis2?.config?.baseUrl || null
  } catch {
    return null
  }
}

function loadCachedConnection() {
  try {
    const raw = sessionStorage.getItem(CONNECTION_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveCachedConnection(profile) {
  try {
    if (profile) {
      sessionStorage.setItem(CONNECTION_CACHE_KEY, JSON.stringify(profile))
    } else {
      sessionStorage.removeItem(CONNECTION_CACHE_KEY)
    }
  } catch {
    // sessionStorage unavailable (private browsing edge cases)
  }
}

function loadSessionToken() {
  try {
    return sessionStorage.getItem(SESSION_TOKEN_KEY) || null
  } catch {
    return null
  }
}

function saveSessionToken(token) {
  try {
    if (token) {
      sessionStorage.setItem(SESSION_TOKEN_KEY, token)
    } else {
      sessionStorage.removeItem(SESSION_TOKEN_KEY)
    }
  } catch {
    // sessionStorage unavailable (private browsing edge cases)
  }
}

function getApiErrorText(err, fallback = 'Connection failed') {
  const payload = err?.response?.data
  const apiError = payload?.error && typeof payload.error === 'object' ? payload.error : null

  const message = apiError?.message || payload?.message || err?.message || fallback
  const hint = apiError?.hint || payload?.hint || ''

  return hint ? `${message} ${hint}` : message
}

export function ConnectionProvider({ children }) {
  const [profiles, setProfiles] = useState([])
  const [connection, setConnection] = useState(() => loadCachedConnection())
  const [sessionToken, setSessionToken] = useState(() => loadSessionToken())
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState(null)
  // True while the initial session-restore or bootstrap call is in-flight.
  // Start as true whenever we have cached connection info or a DHIS2 runtime URL,
  // so AppLayout shows a spinner instead of bouncing to /connect.
  const [restoringSession, setRestoringSession] = useState(
    () => !!loadCachedConnection() || !!getDhis2RuntimeBaseUrl(),
  )
  const sessionExpiredHandlerRef = useRef(null)
  const instance = classifyEnvironment({
    serverInfo: connection?.serverInfo,
    fallbackUrl: connection?.url,
    dhis2Mode: !!getDhis2RuntimeBaseUrl(),
  })

  const clearSession = useCallback(() => {
    setProfiles([])
    setConnection(null)
    setConnectionError(null)
    setRestoringSession(false)
    saveCachedConnection(null)
    setSessionToken(null)
    saveSessionToken(null)
  }, [])

  const applySessionResponse = useCallback((payload) => {
    if (payload?.sessionToken) {
      setSessionToken(payload.sessionToken)
      saveSessionToken(payload.sessionToken)
    }
    const allProfiles = payload?.profiles || []
    const activeId = payload?.activeProfileId
    const activeProfile = payload?.activeProfile || allProfiles.find((p) => p.id === activeId) || null

    setProfiles(allProfiles)
    if (activeProfile) {
      setConnection(activeProfile)
      saveCachedConnection(activeProfile)
    }
  }, [])

  const refreshProfiles = useCallback(async () => {
    try {
      // Cookie is sent automatically via withCredentials
      const response = await api.get('/api/connect/profiles')
      applySessionResponse(response.data)
      return response.data
    } catch {
      clearSession()
      return null
    }
  }, [applySessionResponse, clearSession])

  const connect = useCallback(async (url, username, password, profileName) => {
    setConnecting(true)
    setConnectionError(null)
    try {
      const response = await api.post('/api/connect', { url, username, password, profileName })
      applySessionResponse(response.data)
      return { success: true, user: response.data.user, serverInfo: response.data.serverInfo }
    } catch (err) {
      const message = getApiErrorText(err, 'Connection failed')
      setConnectionError(message)
      return { success: false, error: message }
    } finally {
      setConnecting(false)
    }
  }, [applySessionResponse])

  const switchProfile = useCallback(async (profileId) => {
    try {
      const res = await api.post('/api/connect/profiles/switch', { profileId })
      applySessionResponse(res.data)
      return { success: true }
    } catch (err) {
      const message = getApiErrorText(err, 'Failed to switch profile')
      setConnectionError(message)
      return { success: false, error: message }
    }
  }, [applySessionResponse])

  const removeProfile = useCallback(async (profileId) => {
    try {
      const res = await api.delete(`/api/connect/profiles/${profileId}`)
      applySessionResponse(res.data)
      return { success: true }
    } catch (err) {
      const message = getApiErrorText(err, 'Failed to remove profile')
      setConnectionError(message)
      return { success: false, error: message }
    }
  }, [applySessionResponse])

  const disconnect = useCallback(() => {
    // Fire-and-forget: asks server to destroy the session and clear the cookie
    api.post('/api/connect/disconnect').catch(() => undefined)
    clearSession()
  }, [clearSession])

  // Keep a bearer fallback for forwarded HTTPS environments where the session
  // cookie can be blocked even though the initial connection succeeds.
  const getHeaders = useCallback(
    () => (sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {}),
    [sessionToken],
  )

  /**
   * bootstrap() — used when the app is running inside DHIS2.
   * The server reads DHIS2_API_TOKEN to verify identity; the frontend only
   * supplies the base URL from the DHIS2 runtime config.
   */
  const bootstrap = useCallback(async (baseUrl) => {
    setConnecting(true)
    setConnectionError(null)
    try {
      const response = await api.post('/api/connect/bootstrap', { baseUrl })
      applySessionResponse(response.data)
      return { success: true }
    } catch (err) {
      const message = getApiErrorText(err, 'Auto-connect failed')
      setConnectionError(message)
      return { success: false, error: message }
    } finally {
      setConnecting(false)
    }
  }, [applySessionResponse])

  // On mount: verify the existing cookie session is still alive, or auto-bootstrap
  // from the DHIS2 runtime URL, or fall through to the connect form.
  React.useEffect(() => {
    const dhis2BaseUrl = getDhis2RuntimeBaseUrl()
    const hasCachedConnection = !!loadCachedConnection()

    if (hasCachedConnection) {
      // Validate the existing cookie session with the server
      refreshProfiles().finally(() => setRestoringSession(false))
    } else if (dhis2BaseUrl) {
      // Running inside DHIS2 App Management — bootstrap silently
      bootstrap(dhis2BaseUrl).finally(() => setRestoringSession(false))
    } else {
      setRestoringSession(false)
    }
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
        connection,
        profiles,
        connecting,
        connectionError,
        restoringSession,
        isConnected: !!connection,
        instance,
        /** True when running inside DHIS2 App Management */
        dhis2Mode: !!getDhis2RuntimeBaseUrl(),
        connect,
        bootstrap,
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
