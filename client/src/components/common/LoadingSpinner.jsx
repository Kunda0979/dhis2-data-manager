import React from 'react'
import { Spin } from 'antd'
import { LoadingOutlined } from '@ant-design/icons'

export default function LoadingSpinner({ tip = 'Loading...', size = 'large' }) {
  return (
    <div className="flex flex-col items-center justify-center p-8">
      <Spin indicator={<LoadingOutlined spin />} size={size} tip={tip} />
    </div>
  )
}
