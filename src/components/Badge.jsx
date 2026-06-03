export default function Badge({ status }) {
  const map = {
    pass:               { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Pass' },
    fail:               { cls: 'bg-red-50 text-red-700 border-red-200',             label: 'Fail' },
    warning:            { cls: 'bg-amber-50 text-amber-700 border-amber-200',       label: 'Review' },
    pending:            { cls: 'bg-gray-50 text-gray-500 border-gray-200',          label: 'Pending' },
    pending_extraction: { cls: 'bg-gray-50 text-gray-500 border-gray-200',          label: 'Pending' },
    extracting:         { cls: 'bg-blue-50 text-blue-700 border-blue-200',          label: 'Processing' },
    extracted:          { cls: 'bg-blue-50 text-blue-700 border-blue-200',          label: 'Extracted' },
    verified:           { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', label: 'Verified' },
    failed:             { cls: 'bg-red-50 text-red-700 border-red-200',             label: 'Failed' },
  }
  const { cls, label } = map[status] || map.pending
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium border ${cls}`}>
      {label}
    </span>
  )
}
