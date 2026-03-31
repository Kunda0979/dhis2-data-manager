import React, { useState } from 'react'
import { Form, Input, Button, Card, Alert, Typography, Space, Divider } from 'antd'
import { ApiOutlined, LockOutlined, UserOutlined, LinkOutlined } from '@ant-design/icons'
import { useConnection } from '../../contexts/ConnectionContext.jsx'
import { useNavigate } from 'react-router-dom'

const { Title, Text, Paragraph } = Typography

export default function ConnectionForm() {
  const { connect, connecting, connectionError } = useConnection()
  const navigate = useNavigate()
  const [form] = Form.useForm()

  const handleSubmit = async (values) => {
    const { url, username, password, profileName } = values
    const result = await connect(url.trim(), username.trim(), password, profileName?.trim())
    if (result.success) {
      navigate('/export')
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #0f172a 0%, #0c2340 45%, #0369a1 100%)' }}
    >
      <Card
        bordered={false}
        style={{
          width: '100%',
          maxWidth: 460,
          boxShadow: '0 24px 64px rgba(0,0,0,0.35)',
          borderRadius: 16,
        }}
      >
        <div className="text-center mb-6">
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 16,
              background: 'linear-gradient(135deg, #0369a1 0%, #0ea5e9 100%)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 14,
              boxShadow: '0 4px 16px rgba(3,105,161,0.4)',
            }}
          >
            <ApiOutlined style={{ fontSize: 28, color: '#fff' }} />
          </div>
          <Title level={3} style={{ marginBottom: 0, letterSpacing: '-0.3px' }}>
            DataBridge
          </Title>
          <Text style={{ fontSize: 12, color: '#0369a1', fontWeight: 600, letterSpacing: '0.8px', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>
            for DHIS2
          </Text>
          <Text type="secondary" style={{ fontSize: 13 }}>
            Connect to your DHIS2 instance to get started
          </Text>
        </div>

        {connectionError && (
          <Alert
            type="error"
            message="Connection Failed"
            description={connectionError}
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}

        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          requiredMark={false}
          initialValues={{ url: '' }}
        >
          <Form.Item
            name="url"
            label="DHIS2 Server URL"
            rules={[
              { required: true, message: 'Please enter the DHIS2 server URL' },
              { type: 'url', message: 'Please enter a valid URL (e.g. https://dhis2.example.org)' },
            ]}
          >
            <Input
              prefix={<LinkOutlined />}
              placeholder="https://your-dhis2-instance.org"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="username"
            label="Username"
            rules={[{ required: true, message: 'Please enter your username' }]}
          >
            <Input
              prefix={<UserOutlined />}
              placeholder="admin"
              size="large"
              autoComplete="username"
            />
          </Form.Item>

          <Form.Item
            name="profileName"
            label="Profile Name (optional)"
          >
            <Input
              placeholder="Production / Staging / Country A"
              size="large"
            />
          </Form.Item>

          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: 'Please enter your password' }]}
          >
            <Input.Password
              prefix={<LockOutlined />}
              placeholder="••••••••"
              size="large"
              autoComplete="current-password"
            />
          </Form.Item>

          <Form.Item style={{ marginBottom: 0 }}>
            <Button
              type="primary"
              htmlType="submit"
              size="large"
              block
              loading={connecting}
              icon={<ApiOutlined />}
            >
              {connecting ? 'Connecting...' : 'Connect & Test'}
            </Button>
          </Form.Item>
        </Form>

        <Divider />
        <Paragraph type="secondary" style={{ fontSize: 12, textAlign: 'center', marginBottom: 0 }}>
          Credentials are stored server-side in an expiring in-memory session.
          <br />
          Supports DHIS2 v42+ with the new Tracker API.
        </Paragraph>
      </Card>
    </div>
  )
}
