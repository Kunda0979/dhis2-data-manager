/**
 * Convert an array of objects to CSV string.
 */
export function jsonToCsv(data) {
  if (!data || data.length === 0) return ''
  const headers = Object.keys(data[0])
  const rows = data.map((row) =>
    headers.map((h) => {
      const val = row[h] === null || row[h] === undefined ? '' : String(row[h])
      return val.includes(',') || val.includes('"') || val.includes('\n')
        ? `"${val.replace(/"/g, '""')}"`
        : val
    }).join(',')
  )
  return [headers.join(','), ...rows].join('\n')
}

/**
 * Parse a CSV file (File object) to array of objects.
 */
export function csvToJson(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target.result
        const lines = text.split('\n').filter((l) => l.trim())
        if (lines.length < 2) return resolve([])
        const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''))
        const rows = lines.slice(1).map((line) => {
          const vals = parseCsvLine(line)
          const obj = {}
          headers.forEach((h, i) => { obj[h] = vals[i] !== undefined ? vals[i] : '' })
          return obj
        })
        resolve(rows)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = reject
    reader.readAsText(file)
  })
}

/**
 * Simple CSV line parser that handles quoted fields.
 */
function parseCsvLine(line) {
  const result = []
  let current = ''
  let inQuote = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') { current += '"'; i++ }
      else inQuote = !inQuote
    } else if (ch === ',' && !inQuote) {
      result.push(current.trim()); current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

/**
 * Download data as a file in the browser.
 */
export function downloadFile(data, filename, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Read a JSON file (File object) to parsed object.
 */
export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        resolve(JSON.parse(e.target.result))
      } catch (err) {
        reject(new Error('Invalid JSON file'))
      }
    }
    reader.onerror = reject
    reader.readAsText(file)
  })
}
