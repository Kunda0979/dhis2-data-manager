import { useConnection } from '../contexts/ConnectionContext.jsx'

export function useDhis2Connection() {
  return useConnection()
}
