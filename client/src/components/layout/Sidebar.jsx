import React from 'react'
import { Menu, Typography } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ApiOutlined,
  DownloadOutlined,
  FileTextOutlined,
  UploadOutlined,
  HistoryOutlined,
  SettingOutlined,
} from '@ant-design/icons'

const menuItems = [
  { key: '/downloads', icon: <FileTextOutlined />, label: 'Download Templates' },
  { key: '/export', icon: <DownloadOutlined />, label: 'Export Data' },
  { key: '/import', icon: <UploadOutlined />, label: 'Import Data' },
  { key: '/history', icon: <HistoryOutlined />, label: 'Job History' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
      }}
    >
      {/* Logo area */}
      <div
        style={{
          padding: '20px 16px 18px',
          borderBottom: '1px solid rgba(255,255,255,0.07)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(3,105,161,0.5)',
            }}
          >
            <ApiOutlined style={{ fontSize: 18, color: '#fff' }} />
          </div>
          <div>
            <div
              style={{
                color: '#f1f5f9',
                fontWeight: 700,
                fontSize: 16,
                letterSpacing: '-0.3px',
                lineHeight: 1.2,
              }}
            >
              DataBridge
            </div>
            <div style={{ color: '#64748b', fontSize: 10, fontWeight: 500, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
              for DHIS2
            </div>
          </div>
        </div>
      </div>

      {/* Nav section label */}
      <div style={{ padding: '16px 16px 6px', color: '#475569', fontSize: 10, fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase' }}>
        Navigation
      </div>

      {/* Menu */}
      <Menu
        mode="inline"
        theme="dark"
        selectedKeys={[location.pathname]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        style={{
          background: 'transparent',
          border: 'none',
          flex: 1,
        }}
      />

      {/* Footer */}
      <div
        style={{
          padding: '12px 16px',
          borderTop: '1px solid rgba(255,255,255,0.07)',
          color: '#475569',
          fontSize: 11,
        }}
      >
        DHIS2 v42+ Tracker and Aggregate APIs
      </div>
    </div>
  )
}
