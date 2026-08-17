import React from 'react'
import { Layout, Space, Typography, Button, Tooltip, Select, Tag, Avatar, Alert } from 'antd'
import { DisconnectOutlined, UserOutlined, WifiOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useConnection } from '../../contexts/ConnectionContext.jsx'

const { Header: AntHeader } = Layout
const { Text } = Typography

export default function Header() {
  const { connection, profiles, switchProfile, disconnect, instance, dhis2Mode } = useConnection()
  const navigate = useNavigate()

  const handleDisconnect = () => {
    disconnect()
    navigate('/connect')
  }

  return (
    <AntHeader
      style={{
        background: '#fff',
        padding: '8px 16px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        justifyContent: 'center',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        height: 'auto',
        lineHeight: 'normal',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <Space align="center" size={10}>
          <Tag
            icon={<WifiOutlined />}
            color={instance?.isProduction ? 'error' : 'success'}
            style={{ borderRadius: 20, padding: '2px 10px', fontWeight: 500, fontSize: 12 }}
          >
            {instance?.systemName || connection?.serverInfo?.systemName || connection?.url}
            {instance?.version && (
              <Text type="secondary" style={{ fontSize: 11, marginLeft: 6 }}>
                v{instance.version}
              </Text>
            )}
          </Tag>
          {connection?.profileName && (
            <Tag color="blue" style={{ borderRadius: 20, fontSize: 11 }}>
              {connection.profileName}
            </Tag>
          )}
        </Space>

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
      </div>

      {dhis2Mode && (
        <Alert
          showIcon
          type={instance?.isProduction ? 'warning' : 'info'}
          message={`Instance: ${instance?.systemName || 'Unknown'}${instance?.version ? ` (v${instance.version})` : ''}`}
          description={`Base URL: ${instance?.instanceBaseUrl || 'Unknown'} | Environment: ${instance?.environment || 'unknown'}`}
        />
      )}
    </AntHeader>
  )
}
