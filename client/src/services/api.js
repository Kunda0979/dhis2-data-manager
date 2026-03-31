import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 120000,
})

// Dispatch a custom event so ConnectionContext can clear the session
// when any API call returns 401 (expired/invalid session token).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.dispatchEvent(new CustomEvent('dhis2:session-expired'))
    }
    return Promise.reject(error)
  },
)

export default api
