import React from 'react'
import { Layout, Space, Typography, Button, Tooltip, Select, Tag, Avatar } from 'antd'
import { DisconnectOutlined, UserOutlined, WifiOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useConnection } from '../../contexts/ConnectionContext.jsx'

const { Header: AntHeader } = Layout
const { Text } = Typography

export default function Header() {
  const { connection, profiles, switchProfile, disconnect } = useConnection()
  const navigate = useNavigate()

  const handleDisconnect = () => {
    disconnect()
    navigate('/connect')
  }

  return (
    <AntHeader
      style={{
        background: '#fff',
        padding: '0 16px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 100,
      }}
    >
      {/* Left — connection info */}
      <Space align="center" size={10}>
        <Tag
          icon={<WifiOutlined />}
          color="success"
          style={{ borderRadius: 20, padding: '2px 10px', fontWeight: 500, fontSize: 12 }}
        >
          {connection?.serverInfo?.systemName || connection?.url}
          {connection?.serverInfo?.version && (
            <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
              v{connection.serverInfo.version}
            </Text>
          )}
        </Tag>
        {connection?.profileName && (
          <Tag color="blue" style={{ borderRadius: 20, fontSize: 11 }}>
            {connection.profileName}
          </Tag>
        )}
      </Space>

      {/* Right — profile switcher + user + disconnect */}
      <Space size={8}>
        {profiles?.length > 1 && (
          <Select
            size="small"
            style={{ width: 220 }}
            value={connection?.id}
            options={(profiles || []).map((profile) => ({
              value: profile.id,
              label: `${profile.profileName || profile.username} · ${profile.serverInfo?.systemName || profile.url}`,
            }))}
            onChange={(profileId) => switchProfile(profileId)}
          />
        )}
        <Space size={6} align="center">
          <Avatar
            size={26}
            icon={<UserOutlined />}
            style={{ background: '#0369a1', fontSize: 12 }}
          />
          <Text style={{ fontSize: 13, fontWeight: 500 }}>
            {connection?.user?.displayName || connection?.user?.username}
          </Text>
        </Space>
        <Tooltip title="Disconnect">
          <Button
            icon={<DisconnectOutlined />}
            size="small"
            danger
            onClick={handleDisconnect}
          >
            Disconnect
          </Button>
        </Tooltip>
      </Space>
    </AntHeader>
  )
}
