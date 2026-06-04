export function generateCaseRef() {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase()
  return `VT-${ts}-${rand}`
}
