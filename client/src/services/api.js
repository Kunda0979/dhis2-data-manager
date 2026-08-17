import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 120000,
  // Required so the browser sends the HttpOnly session cookie (dm_sid) with
  // every request, including cross-origin requests in the DHIS2 app context.
  withCredentials: true,
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
