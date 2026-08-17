import React from 'react'
import { Alert, Button, Card, Typography } from 'antd'

const { Paragraph, Text } = Typography

export default class RuntimeErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      errorMessage: '',
    }
  }

  static getDerivedStateFromError(error) {
    return {
      hasError: true,
      errorMessage: error?.message || 'Unexpected runtime error',
    }
  }

  componentDidCatch(error, info) {
    // Keep details in console for debugging while presenting a friendly UI.
    // eslint-disable-next-line no-console
    console.error('Runtime error boundary caught:', error, info)
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children
    }

    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: '#f8fafc' }}>
        <Card style={{ width: '100%', maxWidth: 760 }}>
          <Alert
            type="error"
            showIcon
            message="The page crashed while rendering"
            description="A runtime error occurred. Reload the page. If the issue repeats, share this message with support."
            style={{ marginBottom: 12 }}
          />
          <Paragraph style={{ marginBottom: 8 }}>
            <Text strong>Error:</Text> <Text code>{this.state.errorMessage}</Text>
          </Paragraph>
          <Button type="primary" onClick={() => window.location.reload()}>
            Reload Page
          </Button>
        </Card>
      </div>
    )
  }
}
