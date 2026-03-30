import React from 'react'
import { Layout } from 'antd'
import { Outlet, Navigate } from 'react-router-dom'
import { useConnection } from '../../contexts/ConnectionContext.jsx'
import Sidebar from './Sidebar.jsx'
import Header from './Header.jsx'

const { Content, Sider } = Layout

export default function AppLayout() {
  const { isConnected } = useConnection()

  if (!isConnected) {
    return <Navigate to="/connect" replace />
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        width={220}
        style={{
          background: '#fff',
          boxShadow: '2px 0 8px rgba(0,0,0,0.06)',
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
        <Content style={{ margin: '16px', padding: '16px' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  )
}
