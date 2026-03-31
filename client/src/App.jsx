import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, App as AntApp } from 'antd'
import { ConnectionProvider } from './contexts/ConnectionContext.jsx'
import AppLayout from './components/layout/AppLayout.jsx'
import ConnectPage from './pages/ConnectPage.jsx'
import DownloadsPage from './pages/DownloadsPage.jsx'
import ExportPage from './pages/ExportPage.jsx'
import ImportPage from './pages/ImportPage.jsx'
import HistoryPage from './pages/HistoryPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'

export default function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#0369a1',
          colorLink: '#0369a1',
          borderRadius: 8,
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          colorBgContainer: '#ffffff',
          colorBgLayout: '#f0f4f8',
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
        },
        components: {
          Card: {
            boxShadow: '0 1px 4px rgba(0,0,0,0.07)',
          },
          Menu: {
            darkItemBg: '#0f172a',
            darkSubMenuItemBg: '#1e293b',
            darkItemSelectedBg: '#0369a1',
            darkItemHoverBg: 'rgba(255,255,255,0.08)',
          },
        },
      }}
    >
      <AntApp>
        <ConnectionProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/connect" element={<ConnectPage />} />
              <Route path="/" element={<AppLayout />}>
                <Route index element={<Navigate to="/export" replace />} />
                <Route path="downloads" element={<DownloadsPage />} />
                <Route path="export" element={<ExportPage />} />
                <Route path="import" element={<ImportPage />} />
                <Route path="history" element={<HistoryPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/connect" replace />} />
            </Routes>
          </BrowserRouter>
        </ConnectionProvider>
      </AntApp>
    </ConfigProvider>
  )
}
