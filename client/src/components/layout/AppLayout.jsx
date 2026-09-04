import React from 'react'
import { Layout, Spin } from 'antd'
import { Outlet, Navigate } from 'react-router-dom'
import { useConnection } from '../../contexts/ConnectionContext.jsx'
import Sidebar from './Sidebar.jsx'
import Header from './Header.jsx'

const { Content, Sider } = Layout

export default function AppLayout() {
  const { isConnected, restoringSession, dhis2Mode, connectionError } = useConnection()

  if (restoringSession) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spin size="large" tip={dhis2Mode ? 'Connecting to DHIS2…' : 'Restoring session…'} />
      </div>
    )
  }

  // In DHIS2 mode the bootstrap may fail (e.g. DHIS2_API_TOKEN not set).
  // Show an informative error instead of redirecting to the credential form.
  if (dhis2Mode && !isConnected) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, padding: 32 }}>
        <div style={{ fontSize: 18, fontWeight: 600, color: '#b91c1c' }}>Unable to connect to DHIS2</div>
        <div style={{ maxWidth: 480, textAlign: 'center', color: '#475569' }}>
          {connectionError || 'Auto-connect failed. Ask your administrator to verify the DHIS2_API_TOKEN environment variable is set on the backend server.'}
        </div>
      </div>
    )
  }

  if (!isConnected) {
    return <Navigate to="/connect" replace />
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        style={{
          background: 'transparent',
          boxShadow: '2px 0 12px rgba(0,0,0,0.18)',
          overflow: 'auto',
          height: '100vh',
          position: 'fixed',
          left: 0,
          top: 0,
          bottom: 0,
        }}
      >
        <Sidebar />
      </Sider>
      <Layout style={{ marginLeft: 220 }}>
        <Header />
        <Content style={{ margin: '20px', padding: '0' }} className="page-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
