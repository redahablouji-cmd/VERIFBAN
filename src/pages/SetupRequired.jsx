export default function SetupRequired() {
  const missing = []
  if (!import.meta.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL')
  if (!import.meta.env.VITE_SUPABASE_ANON_KEY) missing.push('VITE_SUPABASE_ANON_KEY')
  if (!import.meta.env.VITE_ANTHROPIC_API_KEY) missing.push('VITE_ANTHROPIC_API_KEY')

  return (
    <div className="min-h-screen bg-[#F7F8FA] flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="flex items-center gap-3 mb-10 justify-center">
          <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
            <rect width="34" height="34" fill="#0F2744" rx="2" />
            <rect x="6" y="6" width="9" height="9" fill="#B8942A" />
            <rect x="19" y="6" width="9" height="9" fill="#B8942A" opacity="0.45" />
            <rect x="6" y="19" width="9" height="9" fill="#B8942A" opacity="0.45" />
            <rect x="19" y="19" width="9" height="9" fill="#B8942A" />
          </svg>
          <span
            style={{ fontFamily: "'Playfair Display', serif" }}
            className="text-xl font-semibold text-navy-900 tracking-tight"
          >
            VerifyTrade
          </span>
        </div>

        <div className="bg-white border border-[#E2E6EA] rounded-lg p-8 shadow-card">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 bg-amber-50 rounded-full flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <div>
              <h1
                style={{ fontFamily: "'Playfair Display', serif" }}
                className="text-xl font-semibold text-navy-900"
              >
                Setup Required
              </h1>
              <p className="text-xs text-gray-400">Environment variables are missing</p>
            </div>
          </div>

          <p className="text-sm text-gray-500 mb-6">
            VerifyTrade needs the following environment variables configured in your Vercel project
            settings before it can start.
          </p>

          <div className="space-y-2 mb-7">
            {['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_ANTHROPIC_API_KEY'].map((key) => {
              const isMissing = missing.includes(key)
              return (
                <div
                  key={key}
                  className={`flex items-center gap-3 px-4 py-3 rounded border ${
                    isMissing
                      ? 'bg-red-50 border-red-200'
                      : 'bg-emerald-50 border-emerald-200'
                  }`}
                >
                  {isMissing ? (
                    <svg className="w-4 h-4 text-red-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  <code className={`text-xs font-mono font-medium ${isMissing ? 'text-red-700' : 'text-emerald-700'}`}>
                    {key}
                  </code>
                  <span className={`ml-auto text-xs ${isMissing ? 'text-red-500' : 'text-emerald-600'}`}>
                    {isMissing ? 'Missing' : 'Set'}
                  </span>
                </div>
              )
            })}
          </div>

          <div className="bg-[#F7F8FA] border border-[#E2E6EA] rounded p-4 text-xs text-gray-500 space-y-1.5">
            <p className="font-semibold text-navy-700 mb-2">How to fix:</p>
            <p>1. Go to your <strong>Vercel project → Settings → Environment Variables</strong></p>
            <p>2. Add each missing variable with the values from your Supabase and Supabase and Anthropic (console.anthropic.com) dashboards</p>
            <p>3. Redeploy (Vercel → Deployments → Redeploy)</p>
          </div>
        </div>
      </div>
    </div>
  )
}
