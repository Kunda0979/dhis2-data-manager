import React from 'react'
import { Layout, Space, Typography, Badge, Button, Tooltip, Select } from 'antd'
import { DisconnectOutlined, CheckCircleFilled } from '@ant-design/icons'
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
      <Space align="center">
        <Badge status="success" />
        <Text strong style={{ fontSize: 13 }}>
          Connected to:{' '}
          <Text type="secondary" style={{ fontSize: 13 }}>
            {connection?.serverInfo?.systemName || connection?.url}
          </Text>
        </Text>
        {connection?.serverInfo?.version && (
          <Text type="secondary" style={{ fontSize: 12 }}>
            v{connection.serverInfo.version}
          </Text>
        )}
      </Space>

      <Space>
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
        <Text type="secondary" style={{ fontSize: 12 }}>
          <CheckCircleFilled style={{ color: '#52c41a', marginRight: 4 }} />
          {connection?.user?.displayName || connection?.user?.username}
        </Text>
        <Tooltip title="Disconnect">
          <Button
            icon={<DisconnectOutlined />}
            size="small"
            onClick={handleDisconnect}
          >
            Disconnect
          </Button>
        </Tooltip>
      </Space>
    </AntHeader>
  )
}
