import React from 'react'
import { Menu, Typography } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  ApiOutlined,
  DownloadOutlined,
  UploadOutlined,
  HistoryOutlined,
  SettingOutlined,
} from '@ant-design/icons'

const { Title } = Typography

const menuItems = [
  { key: '/export', icon: <DownloadOutlined />, label: 'Export Data' },
  { key: '/import', icon: <UploadOutlined />, label: 'Import Data' },
  { key: '/history', icon: <HistoryOutlined />, label: 'Job History' },
  { key: '/settings', icon: <SettingOutlined />, label: 'Settings' },
]

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <ApiOutlined style={{ fontSize: 22, color: '#1677ff' }} />
          <Title level={5} style={{ margin: 0, color: '#1677ff' }}>
            DHIS2 Manager
          </Title>
        </div>
      </div>
      <Menu
        mode="inline"
        selectedKeys={[location.pathname]}
        items={menuItems}
        onClick={({ key }) => navigate(key)}
        style={{ border: 'none', flex: 1 }}
        className="sidebar-menu"
      />
    </div>
  )
}
