import React, { createContext, useContext, useState, useCallback } from 'react'
import api from '../services/api.js'

const ConnectionContext = createContext(null)

export function ConnectionProvider({ children }) {
  const [connection, setConnection] = useState(null) // { url, username, password, user, serverInfo }
  const [connecting, setConnecting] = useState(false)
  const [connectionError, setConnectionError] = useState(null)

  const connect = useCallback(async (url, username, password) => {
    setConnecting(true)
    setConnectionError(null)
    try {
      const response = await api.post('/api/connect', { url, username, password })
      const { user, serverInfo } = response.data
      setConnection({ url, username, password, user, serverInfo })
      return { success: true, user, serverInfo }
    } catch (err) {
      const message = err.response?.data?.message || err.message || 'Connection failed'
      setConnectionError(message)
      return { success: false, error: message }
    } finally {
      setConnecting(false)
    }
  }, [])

  const disconnect = useCallback(() => {
    setConnection(null)
    setConnectionError(null)
  }, [])

  const getHeaders = useCallback(() => {
    if (!connection) return {}
    return {
      'x-dhis2-url': connection.url,
      'x-dhis2-username': connection.username,
      'x-dhis2-password': connection.password,
    }
  }, [connection])

  return (
    <ConnectionContext.Provider
      value={{
        connection,
        connecting,
        connectionError,
        isConnected: !!connection,
        connect,
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
