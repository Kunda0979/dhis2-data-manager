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
    const { url, username, password } = values
    const result = await connect(url.trim(), username.trim(), password)
    if (result.success) {
      navigate('/export')
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <Card
        style={{ width: '100%', maxWidth: 460 }}
        bordered={false}
        className="shadow-xl"
      >
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-50 mb-4">
            <ApiOutlined style={{ fontSize: 32, color: '#1677ff' }} />
          </div>
          <Title level={3} style={{ marginBottom: 4 }}>
            DHIS2 Data Manager
          </Title>
          <Text type="secondary">Connect to your DHIS2 instance to get started</Text>
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
          Your credentials are only stored in memory and never saved to disk.
          <br />
          Supports DHIS2 v42+ with the new Tracker API.
        </Paragraph>
      </Card>
    </div>
  )
}
