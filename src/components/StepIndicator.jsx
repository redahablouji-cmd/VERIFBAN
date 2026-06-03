export default function StepIndicator({ current, steps }) {
  return (
    <div className="flex items-center justify-center mb-10 select-none">
      {steps.map((label, idx) => {
        const n = idx + 1
        const done = n < current
        const active = n === current
        return (
          <div key={label} className="flex items-center">
            <div className="flex flex-col items-center">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-all ${
                  done
                    ? 'bg-navy-900 border-navy-900 text-white'
                    : active
                    ? 'border-gold-500 text-gold-500 bg-white'
                    : 'border-[#E2E6EA] text-gray-400 bg-white'
                }`}
              >
                {done ? (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : n}
              </div>
              <span
                className={`mt-2 text-xs font-medium whitespace-nowrap ${
                  active ? 'text-navy-900' : done ? 'text-navy-600' : 'text-gray-400'
                }`}
              >
                {label}
              </span>
            </div>
            {idx < steps.length - 1 && (
              <div className={`w-20 sm:w-28 h-px mx-3 mb-5 ${done ? 'bg-navy-900' : 'bg-[#E2E6EA]'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
