import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import Badge from '../components/Badge.jsx'

function StatCard({ label, value, sub, delay }) {
  return (
    <div className={`bg-white border border-[#E2E6EA] rounded-lg p-6 shadow-card fade-in-${delay}`}>
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">{label}</p>
      <p className="font-display text-3xl font-semibold text-navy-900">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  )
}

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function Dashboard() {
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()

  useEffect(() => {
    supabase
      .from('cases')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50)
      .then(({ data }) => {
        setCases(data || [])
        setLoading(false)
      })
  }, [])

  const total = cases.length
  const passed = cases.filter((c) => c.overall_result === 'pass').length
  const verifiedRate = total > 0 ? Math.round((passed / total) * 100) : 0
  const today = new Date().toISOString().slice(0, 10)
  const pendingToday = cases.filter(
    (c) => c.status !== 'verified' && c.created_at?.slice(0, 10) === today,
  ).length
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const thisWeek = cases.filter((c) => c.created_at > weekAgo).length
  const recent = cases.slice(0, 10)

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8 fade-in">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-1">Import payment verification overview</p>
        </div>
        <Link
          to="/cases/new"
          className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-5 py-2.5 rounded hover:bg-navy-800 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Verification
        </Link>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        <StatCard label="Total Cases"        value={loading ? '—' : total}            sub="All time"                          delay={1} />
        <StatCard label="Auto-Verified Rate" value={loading ? '—' : `${verifiedRate}%`} sub={`${passed} of ${total} passed`} delay={2} />
        <StatCard label="Cases This Week"    value={loading ? '—' : thisWeek}                                                delay={3} />
        <StatCard label="Pending Today"      value={loading ? '—' : pendingToday}     sub="Awaiting review"                  delay={4} />
      </div>

      <div className="bg-white border border-[#E2E6EA] rounded-lg shadow-card fade-in-5">
        <div className="px-6 py-4 border-b border-[#E2E6EA] flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-navy-900">Recent Cases</h2>
          <Link to="/cases" className="text-xs font-medium text-gold-500 hover:text-gold-600 transition-colors">
            View all →
          </Link>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-gray-400">Loading cases…</div>
        ) : recent.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-display text-lg text-navy-900 mb-1">No cases yet</p>
            <p className="text-sm text-gray-400 mb-6">Start your first verification to see results here.</p>
            <Link
              to="/cases/new"
              className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-5 py-2.5 rounded hover:bg-navy-800 transition-colors"
            >
              New Verification
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E6EA]">
                  {['Case Ref', 'Client', 'Date', 'Files', 'Result'].map((h) => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {recent.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/cases/${c.id}`)}
                    className="border-b border-[#E2E6EA] last:border-0 hover:bg-navy-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 font-mono text-xs font-medium text-navy-900">{c.case_ref}</td>
                    <td className="px-6 py-4 text-navy-700">{c.client_name || '—'}</td>
                    <td className="px-6 py-4 text-gray-400">{formatDate(c.created_at)}</td>
                    <td className="px-6 py-4 text-navy-700">{c.file_count ?? '—'}</td>
                    <td className="px-6 py-4">
                      <Badge status={
                        c.overall_result === 'pass' ? 'pass'
                        : c.overall_result === 'fail' ? 'fail'
                        : 'pending'
                      } />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
