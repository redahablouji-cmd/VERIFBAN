import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import Badge from '../components/Badge.jsx'

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export default function CasesList() {
  const [cases, setCases] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    supabase
      .from('cases')
      .select('*')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        setCases(data || [])
        setLoading(false)
      })
  }, [])

  const filtered = cases.filter(
    (c) =>
      !search ||
      c.case_ref?.toLowerCase().includes(search.toLowerCase()) ||
      c.client_name?.toLowerCase().includes(search.toLowerCase()),
  )

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8 fade-in">
        <div>
          <h1 className="font-display text-3xl font-semibold text-navy-900">All Cases</h1>
          <p className="text-sm text-gray-400 mt-1">
            {cases.length} verification{cases.length !== 1 ? 's' : ''} on record
          </p>
        </div>
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search by ref or client…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 pr-4 py-2 text-sm border border-[#E2E6EA] rounded bg-white focus:outline-none focus:ring-2 focus:ring-navy-900 focus:border-transparent w-64"
          />
        </div>
      </div>

      <div className="bg-white border border-[#E2E6EA] rounded-lg shadow-card fade-in-1">
        {loading ? (
          <div className="p-12 text-center text-sm text-gray-400">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">
            {search ? `No cases matching "${search}"` : 'No cases found.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#E2E6EA]">
                  {['Case Ref', 'Client', 'Date', 'Files', 'Passed', 'Failed', 'Result', ''].map((h) => (
                    <th key={h} className="px-6 py-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => navigate(`/cases/${c.id}`)}
                    className="border-b border-[#E2E6EA] last:border-0 hover:bg-navy-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-4 font-mono text-xs font-medium text-navy-900">{c.case_ref}</td>
                    <td className="px-6 py-4 text-navy-700">{c.client_name || '—'}</td>
                    <td className="px-6 py-4 text-gray-400">{formatDate(c.created_at)}</td>
                    <td className="px-6 py-4 text-navy-700">{c.file_count ?? '—'}</td>
                    <td className="px-6 py-4 font-medium text-emerald-600">{c.pass_count ?? '—'}</td>
                    <td className="px-6 py-4 font-medium text-red-600">{c.fail_count ?? '—'}</td>
                    <td className="px-6 py-4">
                      <Badge status={
                        c.overall_result === 'pass' ? 'pass'
                        : c.overall_result === 'fail' ? 'fail'
                        : c.status || 'pending'
                      } />
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-xs font-medium text-gold-500">View →</span>
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
