import { Link, useLocation } from 'react-router-dom'

function LogoMark() {
  return (
    <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
      <rect width="34" height="34" fill="#0F2744" rx="2" />
      <rect x="6" y="6" width="9" height="9" fill="#B8942A" />
      <rect x="19" y="6" width="9" height="9" fill="#B8942A" opacity="0.45" />
      <rect x="6" y="19" width="9" height="9" fill="#B8942A" opacity="0.45" />
      <rect x="19" y="19" width="9" height="9" fill="#B8942A" />
    </svg>
  )
}

export default function Header() {
  const { pathname } = useLocation()

  const nav = [
    { to: '/', label: 'Dashboard' },
    { to: '/cases', label: 'All Cases' },
  ]

  return (
    <header className="bg-white border-b border-[#E2E6EA] sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3 shrink-0">
          <LogoMark />
          <span className="font-display text-xl font-semibold text-navy-900 tracking-tight">
            VerifyTrade
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {nav.map(({ to, label }) => (
            <Link
              key={to}
              to={to}
              className={`px-4 py-2 rounded text-sm font-medium transition-colors ${
                pathname === to
                  ? 'bg-navy-50 text-navy-900'
                  : 'text-navy-600 hover:text-navy-900 hover:bg-gray-50'
              }`}
            >
              {label}
            </Link>
          ))}
        </nav>

        <Link
          to="/cases/new"
          className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-4 py-2 rounded hover:bg-navy-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Verification
        </Link>
      </div>
    </header>
  )
}
