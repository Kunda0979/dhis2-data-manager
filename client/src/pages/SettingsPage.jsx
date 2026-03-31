import React, { useState, useEffect } from 'react'
import {
  Typography,
  Card,
  Form,
  Select,
  InputNumber,
  Switch,
  Button,
  Divider,
  App,
} from 'antd'
import { SaveOutlined, SettingOutlined } from '@ant-design/icons'

const { Title, Text } = Typography

const SETTINGS_KEY = 'dhis2_settings'

const DEFAULT_SETTINGS = {
  defaultFormat: 'json',
  defaultPageSize: 100,
  defaultImportStrategy: 'CREATE_AND_UPDATE',
  darkMode: false,
}

function loadSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function getSettings() {
  return loadSettings()
}

export default function SettingsPage() {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [settings, setSettings] = useState(loadSettings)

  useEffect(() => {
    form.setFieldsValue(settings)
  }, [])

  const handleSave = (values) => {
    const updated = { ...DEFAULT_SETTINGS, ...values }
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(updated))
    setSettings(updated)
    message.success('Settings saved')
  }

  return (
    <div>
      <div
        style={{
          marginBottom: 20,
          padding: '16px 20px',
          background: '#fff',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        }}
      >
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 10,
            background: 'linear-gradient(135deg, #b45309, #fbbf24)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <SettingOutlined style={{ color: '#fff', fontSize: 16 }} />
        </div>
        <div>
          <Title level={5} style={{ margin: 0 }}>Settings</Title>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            Configure default export and import preferences
          </Typography.Text>
        </div>
      </div>

      <Card style={{ maxWidth: 520 }}>
        <Form form={form} layout="vertical" onFinish={handleSave} initialValues={settings}>
          <Form.Item label="Default Export Format" name="defaultFormat">
            <Select
              options={[
                { value: 'json', label: 'JSON' },
                { value: 'csv', label: 'CSV' },
                { value: 'xlsx', label: 'Excel (.xlsx)' },
              ]}
              style={{ width: 180 }}
            />
          </Form.Item>

          <Form.Item label="Default Page Size" name="defaultPageSize" help="Number of records per page when fetching from DHIS2">
            <InputNumber min={10} max={1000} step={10} style={{ width: 120 }} />
          </Form.Item>

          <Form.Item label="Default Import Strategy" name="defaultImportStrategy">
            <Select
              options={[
                { value: 'CREATE', label: 'CREATE' },
                { value: 'UPDATE', label: 'UPDATE' },
                { value: 'CREATE_AND_UPDATE', label: 'CREATE_AND_UPDATE' },
                { value: 'DELETE', label: 'DELETE' },
              ]}
              style={{ width: 220 }}
            />
          </Form.Item>

          <Divider />

          <Form.Item>
            <Button type="primary" htmlType="submit" icon={<SaveOutlined />}>
              Save Settings
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Card style={{ maxWidth: 520, marginTop: 16 }} size="small">
        <Text type="secondary" style={{ fontSize: 12 }}>
          Settings are stored in your browser's localStorage and are specific to this device.
          <br />
          Your DHIS2 credentials are <strong>never</strong> stored — they are only held in memory for the current session.
        </Text>
      </Card>
    </div>
  )
}
