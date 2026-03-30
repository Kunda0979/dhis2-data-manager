import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ConfigProvider, App as AntApp } from 'antd'
import { ConnectionProvider } from './contexts/ConnectionContext.jsx'
import AppLayout from './components/layout/AppLayout.jsx'
import ConnectPage from './pages/ConnectPage.jsx'
import ExportPage from './pages/ExportPage.jsx'
import ImportPage from './pages/ImportPage.jsx'
import HistoryPage from './pages/HistoryPage.jsx'
import SettingsPage from './pages/SettingsPage.jsx'

export default function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
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
