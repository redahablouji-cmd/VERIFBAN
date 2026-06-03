export function generateCaseRef() {
  const ts = Date.now().toString(36).toUpperCase().slice(-4)
  const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `VT-${ts}-${rand}`
}
