import React from 'react'
import { Layout, Spin } from 'antd'
import { Outlet, Navigate } from 'react-router-dom'
import { useConnection } from '../../contexts/ConnectionContext.jsx'
import Sidebar from './Sidebar.jsx'
import Header from './Header.jsx'

const { Content, Sider } = Layout

export default function AppLayout() {
  const { isConnected, restoringSession } = useConnection()

  if (restoringSession) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spin size="large" tip="Restoring session…" />
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
