function safeParseUrl(rawUrl) {
  try {
    return rawUrl ? new URL(rawUrl) : null
  } catch {
    return null
  }
}

function classifyEnvironment({ serverInfo, fallbackUrl, dhis2Mode = false }) {
  const baseUrl = serverInfo?.instanceBaseUrl || fallbackUrl || ''
  const parsed = safeParseUrl(baseUrl)
  const hostname = (parsed?.hostname || '').toLowerCase()
  const systemName = String(serverInfo?.systemName || '').toLowerCase()

  const devHostHints = ['localhost', '127.0.0.1', '0.0.0.0']
  const nonProdHints = ['dev', 'test', 'staging', 'stage', 'sandbox', 'demo', 'play.dhis2.org']
  const prodHints = ['prod', 'production', 'live']

  const matchesHint = (hints, value) => hints.some((hint) => value.includes(hint))

  const hasDevHostHint = matchesHint(devHostHints, hostname)
  const hasNonProdHint = matchesHint(nonProdHints, hostname) || matchesHint(nonProdHints, systemName)
  const hasProdHint = matchesHint(prodHints, hostname) || matchesHint(prodHints, systemName)

  let environment = 'unknown'
  if (hasDevHostHint || hasNonProdHint) {
    environment = 'non-production'
  } else if (hasProdHint || (dhis2Mode && hostname && !hasNonProdHint)) {
    environment = 'production'
  }

  return {
    environment,
    isProduction: environment === 'production',
    hostname: hostname || null,
    instanceBaseUrl: baseUrl || null,
    systemName: serverInfo?.systemName || 'Unknown DHIS2',
    version: serverInfo?.version || null,
    identifier: serverInfo?.instanceBaseUrl || hostname || fallbackUrl || 'Unknown instance',
  }
}

export { classifyEnvironment }
