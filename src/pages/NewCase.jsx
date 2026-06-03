import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { extractDocumentFields } from '../lib/claude.js'
import { runVerificationRules } from '../lib/verification.js'
import { generateCaseRef } from '../lib/caseRef.js'
import StepIndicator from '../components/StepIndicator.jsx'
import Badge from '../components/Badge.jsx'

const STEPS = ['Document Intake', 'AI Extraction', 'Verification']

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────
function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

function groupBy(arr, key) {
  return arr.reduce((acc, item) => {
    const k = item[key] || 'other'
    if (!acc[k]) acc[k] = []
    acc[k].push(item)
    return acc
  }, {})
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality check — validates size, PDF magic bytes, and text-layer presence
// ─────────────────────────────────────────────────────────────────────────────
async function runQualityCheck(file) {
  if (file.size < 5000) return { status: 'fail', message: 'File too small — may be empty or corrupt' }
  if (file.size > 50 * 1024 * 1024) return { status: 'fail', message: 'File exceeds 50 MB limit' }

  const ext = file.name.split('.').pop().toLowerCase()

  if (ext === 'pdf' || file.type === 'application/pdf') {
    // Validate PDF magic bytes
    try {
      const buf = await file.slice(0, 5).arrayBuffer()
      const magic = String.fromCharCode(...new Uint8Array(buf))
      if (!magic.startsWith('%PDF')) {
        return { status: 'fail', message: 'Not a valid PDF — file may be corrupt or mislabelled' }
      }
    } catch {
      return { status: 'fail', message: 'Could not read file' }
    }

    // Detect scan-only PDFs: ratio of printable ASCII in first 120 KB
    try {
      const sampleSize = Math.min(file.size, 120000)
      const buf = await file.slice(0, sampleSize).arrayBuffer()
      const bytes = new Uint8Array(buf)
      let printable = 0
      for (let i = 0; i < bytes.length; i++) {
        const b = bytes[i]
        if ((b >= 32 && b <= 126) || b === 9 || b === 10 || b === 13) printable++
      }
      if (printable / sampleSize < 0.08) {
        return {
          status: 'fail',
          message: 'PDF contains no text layer (scanned image only) — AI cannot read it. Please use a searchable PDF.',
        }
      }
    } catch { /* skip if read fails */ }
  }

  if (ext === 'txt') {
    try {
      const text = await file.text()
      if (text.trim().length < 30) return { status: 'fail', message: 'Text file is empty or too short' }
    } catch {
      return { status: 'fail', message: 'Could not read text file' }
    }
  }

  return { status: 'pass', message: 'Quality check passed' }
}

const REQUIRED_DOCS = [
  {
    type: 'invoice',
    label: 'Commercial Invoice',
    description: 'Issued by supplier — confirms goods, price, currency and parties',
    hint: 'e.g. invoice.pdf, inv_2024.pdf',
  },
  {
    type: 'letter_of_credit',
    label: 'Letter of Credit',
    description: 'Issued by the opening bank — defines payment terms, amounts and validity',
    hint: 'e.g. lc_2024.pdf, letter_of_credit.pdf',
  },
  {
    type: 'bill_of_lading',
    label: 'Bill of Lading',
    description: 'Issued by the carrier — confirms shipment routing and consignee details',
    hint: 'e.g. bl_001.pdf, bill_of_lading.pdf',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Structured document slots with pre-upload quality checks
// ─────────────────────────────────────────────────────────────────────────────
function Step1({ onComplete }) {
  const [clientName, setClientName] = useState('')
  const [slots, setSlots] = useState({
    invoice:          { file: null, qc: null, qcMessage: '' },
    letter_of_credit: { file: null, qc: null, qcMessage: '' },
    bill_of_lading:   { file: null, qc: null, qcMessage: '' },
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileRefs = useRef({})

  const handleFileChange = async (docType, file) => {
    if (!file) return
    setSlots((prev) => ({ ...prev, [docType]: { file, qc: 'checking', qcMessage: '' } }))
    const result = await runQualityCheck(file)
    setSlots((prev) => ({ ...prev, [docType]: { file, qc: result.status, qcMessage: result.message } }))
  }

  const removeSlot = (docType) => {
    setSlots((prev) => ({ ...prev, [docType]: { file: null, qc: null, qcMessage: '' } }))
    if (fileRefs.current[docType]) fileRefs.current[docType].value = ''
  }

  const readyCount = REQUIRED_DOCS.filter(({ type }) => slots[type].qc === 'pass').length
  const allReady = clientName.trim().length > 0 && readyCount === 3

  const handleSubmit = async () => {
    if (!clientName.trim()) { setError('Please enter a client name.'); return }
    setError('')
    setSubmitting(true)

    try {
      const caseRef = generateCaseRef()
      const fileList = REQUIRED_DOCS.map(({ type }) => slots[type].file).filter(Boolean)

      const { data: caseRow, error: caseErr } = await supabase
        .from('cases')
        .insert({
          case_ref: caseRef,
          client_name: clientName.trim(),
          status: 'pending_extraction',
          file_count: fileList.length,
          pass_count: 0,
          fail_count: 0,
          warn_count: 0,
          overall_result: 'pending',
        })
        .select()
        .single()

      if (caseErr) {
        if (caseErr.code === '42P01') {
          throw new Error('Database tables not found. Run supabase/schema.sql in your Supabase SQL Editor first.')
        }
        throw caseErr
      }

      for (const { type } of REQUIRED_DOCS) {
        const slot = slots[type]
        if (!slot.file) continue
        const safeName = slot.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `cases/${caseRef}/${safeName}`

        const { error: uploadErr } = await supabase.storage
          .from('trade-documents')
          .upload(path, slot.file, {
            contentType: slot.file.type || 'application/octet-stream',
            upsert: true,
          })

        if (uploadErr && !uploadErr.message?.includes('already exists')) {
          console.warn('Storage upload warning:', uploadErr.message)
        }

        await supabase.from('documents').insert({
          case_id: caseRow.id,
          file_name: slot.file.name,
          file_type: type,
          storage_path: path,
        })
      }

      onComplete({ caseId: caseRow.id, caseRef, files: fileList })
    } catch (err) {
      setError(err.message || 'Failed to create case.')
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-navy-900 mb-1">Document Intake</h2>
      <p className="text-sm text-gray-400 mb-8">Upload all three required trade documents to proceed.</p>

      {/* Client name */}
      <div className="mb-8">
        <label className="block text-sm font-medium text-navy-700 mb-2">Client Name</label>
        <input
          type="text"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="e.g. Moroccan Import Co."
          className="w-full max-w-md border border-[#E2E6EA] rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy-900 focus:border-transparent bg-white"
        />
      </div>

      {/* Document slots */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-navy-900">Required Documents</h3>
          <span className="text-xs text-gray-400 tabular-nums">{readyCount} / 3 ready</span>
        </div>

        <div className="space-y-3">
          {REQUIRED_DOCS.map(({ type, label, description, hint }, idx) => {
            const { file, qc, qcMessage } = slots[type]
            return (
              <div
                key={type}
                className={`border rounded-lg transition-all ${
                  qc === 'fail'     ? 'border-red-300 bg-red-50/60' :
                  qc === 'pass'     ? 'border-emerald-300 bg-emerald-50/50' :
                  qc === 'checking' ? 'border-blue-200 bg-white' :
                                      'border-[#E2E6EA] bg-white'
                }`}
              >
                <div className="px-5 py-4 flex items-start gap-4">
                  {/* Status circle */}
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 mt-0.5 border ${
                    qc === 'pass'     ? 'bg-emerald-100 border-emerald-300' :
                    qc === 'fail'     ? 'bg-red-100 border-red-300' :
                    qc === 'checking' ? 'bg-white border-blue-200' :
                                        'bg-[#F7F8FA] border-[#E2E6EA]'
                  }`}>
                    {qc === 'pass' && (
                      <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                    {qc === 'fail' && (
                      <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                    {qc === 'checking' && (
                      <div className="w-4 h-4 border-2 border-navy-600 border-t-transparent rounded-full animate-spin" />
                    )}
                    {!qc && <span className="text-xs font-semibold text-gray-400">{idx + 1}</span>}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-navy-900">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{description}</p>

                    {file ? (
                      <div className="mt-2 flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 text-navy-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <span className="text-xs font-medium text-navy-700 truncate">{file.name}</span>
                        <span className="text-xs text-gray-400 shrink-0">· {formatSize(file.size)}</span>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-300 mt-1 italic">{hint}</p>
                    )}

                    {qc === 'pass' && (
                      <p className="text-xs text-emerald-600 font-medium mt-1.5">✓ Quality check passed — ready for AI extraction</p>
                    )}
                    {qc === 'fail' && (
                      <p className="text-xs text-red-600 font-medium mt-1.5">✗ {qcMessage}</p>
                    )}
                    {qc === 'checking' && (
                      <p className="text-xs text-gray-400 mt-1.5">Checking quality…</p>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex items-center gap-2 shrink-0 mt-0.5">
                    {file && (
                      <button
                        onClick={() => removeSlot(type)}
                        className="w-7 h-7 flex items-center justify-center rounded hover:bg-red-100 text-gray-300 hover:text-red-500 transition-colors"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                    <input
                      ref={(el) => { fileRefs.current[type] = el }}
                      type="file"
                      accept=".pdf,.txt,.docx"
                      className="hidden"
                      onChange={(e) => handleFileChange(type, e.target.files[0])}
                    />
                    <button
                      onClick={() => fileRefs.current[type]?.click()}
                      className={`text-xs font-medium px-3 py-1.5 rounded border transition-colors ${
                        file
                          ? 'border-[#E2E6EA] text-gray-500 hover:border-navy-300 hover:text-navy-700 bg-white'
                          : 'border-navy-900 text-navy-900 bg-white hover:bg-navy-900 hover:text-white'
                      }`}
                    >
                      {file ? 'Replace' : 'Upload'}
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {error && (
        <div className="mb-5 px-4 py-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!allReady || submitting}
        className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-6 py-2.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-navy-800"
      >
        {submitting ? 'Creating case…' : 'Create Case & Upload Documents'}
        {!submitting && (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        )}
      </button>
      {!allReady && !submitting && (
        <p className="text-xs text-gray-400 mt-2">
          {!clientName.trim()
            ? 'Enter a client name and upload all 3 documents to continue.'
            : `${3 - readyCount} document${3 - readyCount !== 1 ? 's' : ''} still needed — all must pass quality checks.`}
        </p>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 Success panel
// ─────────────────────────────────────────────────────────────────────────────
function Step1Success({ caseRef, files, onNext }) {
  const docLabel = { invoice: 'Commercial Invoice', letter_of_credit: 'Letter of Credit', bill_of_lading: 'Bill of Lading' }
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-8 h-8 bg-emerald-100 rounded-full flex items-center justify-center">
          <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <p className="text-sm font-semibold text-navy-900">Case created successfully</p>
          <p className="text-xs text-gray-400 font-mono">{caseRef}</p>
        </div>
      </div>

      <div className="bg-white border border-[#E2E6EA] rounded-lg divide-y divide-[#E2E6EA] mb-8">
        {files.map((file, i) => (
          <div key={file.name} className="px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-navy-900 flex-1 truncate">{file.name}</span>
            <span className="text-xs text-gray-400">{docLabel[REQUIRED_DOCS[i]?.type] || 'Document'}</span>
          </div>
        ))}
      </div>

      <button
        onClick={onNext}
        className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-6 py-2.5 rounded hover:bg-navy-800 transition-colors"
      >
        Run Extraction
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
        </svg>
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — AI Extraction
// ─────────────────────────────────────────────────────────────────────────────
function Step2({ caseId, files, onComplete }) {
  const [status, setStatus] = useState('idle')
  const [extracted, setExtracted] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  const run = async () => {
    setStatus('running')
    try {
      await supabase.from('cases').update({ status: 'extracting' }).eq('id', caseId)

      const data = await extractDocumentFields(files)
      setExtracted(data)

      const rows = []
      for (const [docType, fields] of Object.entries(data)) {
        if (!fields) continue
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
          if (fieldValue !== null && fieldValue !== undefined) {
            rows.push({ case_id: caseId, doc_type: docType, field_name: fieldName, field_value: String(fieldValue), confidence: 'high' })
          }
        }
      }
      if (rows.length > 0) await supabase.from('extracted_fields').insert(rows)

      await supabase.from('cases').update({ status: 'extracted' }).eq('id', caseId)
      setStatus('done')
    } catch (err) {
      setErrorMsg(err.message || 'Extraction failed.')
      await supabase.from('cases').update({ status: 'failed' }).eq('id', caseId)
      setStatus('error')
    }
  }

  const docTypeDisplay = { invoice: 'Invoice', letterOfCredit: 'Letter of Credit', billOfLading: 'Bill of Lading' }

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-navy-900 mb-1">AI Extraction</h2>
      <p className="text-sm text-gray-400 mb-8">Extract structured fields from your documents using AI.</p>

      {status === 'idle' && (
        <button onClick={run} className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-6 py-2.5 rounded hover:bg-navy-800 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Start AI Extraction
        </button>
      )}

      {status === 'running' && (
        <div className="flex flex-col items-center py-16 gap-4">
          <div className="w-10 h-10 border-2 border-navy-900 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-navy-900">Analysing documents with AI…</p>
          <p className="text-xs text-gray-400">This may take 15–30 seconds</p>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-5 mb-6">
          <p className="text-sm font-medium text-red-800">Extraction failed</p>
          <p className="text-xs text-red-600 mt-1">{errorMsg}</p>
          <button onClick={run} className="mt-3 text-xs font-medium text-red-700 underline">Retry</button>
        </div>
      )}

      {status === 'done' && extracted && (
        <div>
          <div className="flex items-center gap-2 mb-6">
            <div className="w-5 h-5 bg-emerald-100 rounded-full flex items-center justify-center">
              <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="text-sm font-semibold text-emerald-700">Extraction complete</p>
          </div>

          <div className="space-y-4 mb-8">
            {Object.entries(extracted).map(([docType, fields]) => {
              if (!fields) return null
              return (
                <div key={docType} className="bg-white border border-[#E2E6EA] rounded-lg overflow-hidden">
                  <div className="px-5 py-3 bg-[#F7F8FA] border-b border-[#E2E6EA]">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {docTypeDisplay[docType] || docType}
                    </span>
                  </div>
                  <div className="divide-y divide-[#E2E6EA]">
                    {Object.entries(fields).map(([key, val]) => (
                      <div key={key} className="px-5 py-3 flex justify-between gap-4">
                        <span className="text-sm text-gray-400 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>
                        {val !== null ? (
                          <span className="text-sm font-medium text-navy-900 text-right">{String(val)}</span>
                        ) : (
                          <span className="text-sm text-gray-300 italic">Not found</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <button
            onClick={() => onComplete(extracted)}
            className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-6 py-2.5 rounded hover:bg-navy-800 transition-colors"
          >
            Run Verification
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
            </svg>
          </button>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Verification
// ─────────────────────────────────────────────────────────────────────────────
function ResultRow({ result }) {
  const isFail = result.status === 'fail'
  const isWarn = result.status === 'warning'
  return (
    <div className={`px-5 py-4 flex items-start justify-between gap-4 ${isFail ? 'border-l-2 border-red-500 bg-red-50' : isWarn ? 'bg-amber-50/40' : ''}`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-navy-900">{result.check_name}</p>
        <div className="flex gap-6 mt-1">
          <span className="text-xs text-gray-400">Expected: <span className="text-navy-700">{result.expected_value}</span></span>
          <span className="text-xs text-gray-400">Found: <span className="text-navy-700">{result.found_value}</span></span>
        </div>
        {result.note && <p className="text-xs text-gray-400 mt-0.5 italic">{result.note}</p>}
      </div>
      <Badge status={result.status} />
    </div>
  )
}

function Step3({ caseId, extractedData }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState('idle')
  const [verificationData, setVerificationData] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  const run = async () => {
    setStatus('running')
    try {
      const { results, passCount, failCount, warnCount, overallResult } = runVerificationRules(extractedData)

      const rows = results.map((r) => ({ ...r, case_id: caseId }))
      await supabase.from('verification_results').insert(rows)

      await supabase.from('cases').update({
        pass_count: passCount,
        fail_count: failCount,
        warn_count: warnCount,
        overall_result: overallResult,
        status: 'verified',
      }).eq('id', caseId)

      setVerificationData({ results, passCount, failCount, warnCount, overallResult })
      setStatus('done')
    } catch (err) {
      setErrorMsg(err.message || 'Verification failed.')
      setStatus('error')
    }
  }

  const groupedResults = verificationData ? groupBy(verificationData.results, 'category') : {}
  const isPassed = verificationData?.overallResult === 'pass'
  const total = verificationData
    ? verificationData.passCount + verificationData.failCount + verificationData.warnCount
    : 0

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-navy-900 mb-1">Verification</h2>
      <p className="text-sm text-gray-400 mb-8">Automatically cross-check all document rules.</p>

      {status === 'idle' && (
        <button onClick={run} className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-6 py-2.5 rounded hover:bg-navy-800 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Run Verification
        </button>
      )}

      {status === 'running' && (
        <div className="flex flex-col items-center py-16 gap-4">
          <div className="w-10 h-10 border-2 border-navy-900 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-medium text-navy-900">Running verification rules…</p>
        </div>
      )}

      {status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-5 mb-6">
          <p className="text-sm font-medium text-red-800">Verification failed</p>
          <p className="text-xs text-red-600 mt-1">{errorMsg}</p>
        </div>
      )}

      {status === 'done' && verificationData && (
        <div>
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Checks', val: total,                          cls: 'text-navy-900' },
              { label: 'Passed',       val: verificationData.passCount,     cls: 'text-emerald-600' },
              { label: 'Failed',       val: verificationData.failCount,     cls: 'text-red-600' },
              { label: 'Review',       val: verificationData.warnCount,     cls: 'text-amber-600' },
            ].map(({ label, val, cls }) => (
              <div key={label} className="bg-white border border-[#E2E6EA] rounded-lg p-4 text-center shadow-card">
                <p className={`font-display text-2xl font-semibold ${cls}`}>{val}</p>
                <p className="text-xs text-gray-400 mt-1">{label}</p>
              </div>
            ))}
          </div>

          <div className={`rounded-lg px-5 py-4 mb-6 flex items-center gap-3 ${isPassed ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${isPassed ? 'bg-emerald-600' : 'bg-red-600'}`}>
              {isPassed ? (
                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
            </div>
            <p className={`text-sm font-semibold ${isPassed ? 'text-emerald-800' : 'text-red-800'}`}>
              {isPassed
                ? 'File passes all checks — ready for bank queue'
                : `${verificationData.failCount} discrepanc${verificationData.failCount === 1 ? 'y' : 'ies'} found — client notification required`}
            </p>
          </div>

          <div className="bg-white border border-[#E2E6EA] rounded-lg overflow-hidden mb-8">
            {Object.entries(groupedResults).map(([cat, rs], i) => (
              <div key={cat}>
                {i > 0 && <div className="h-px bg-[#E2E6EA]" />}
                <div className="px-5 py-2.5 bg-[#F7F8FA] border-b border-[#E2E6EA]">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{cat}</span>
                </div>
                <div className="divide-y divide-[#E2E6EA]">
                  {rs.map((r, j) => <ResultRow key={j} result={r} />)}
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => navigate(`/cases/${caseId}`)}
              className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-6 py-2.5 rounded hover:bg-navy-800 transition-colors"
            >
              View Full Case Report
            </button>
            <button
              onClick={() => navigate('/cases')}
              className="inline-flex items-center gap-2 border border-[#E2E6EA] text-navy-700 text-sm font-medium px-6 py-2.5 rounded hover:bg-gray-50 transition-colors"
            >
              All Cases
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main NewCase page
// ─────────────────────────────────────────────────────────────────────────────
export default function NewCase() {
  const [step, setStep] = useState(1)
  const [caseId, setCaseId] = useState(null)
  const [caseRef, setCaseRef] = useState(null)
  const [uploadedFiles, setUploadedFiles] = useState([])
  const [step1Done, setStep1Done] = useState(false)
  const [extractedData, setExtractedData] = useState(null)

  const handleStep1Complete = ({ caseId: id, caseRef: ref, files }) => {
    setCaseId(id)
    setCaseRef(ref)
    setUploadedFiles(files)
    setStep1Done(true)
  }

  const handleStep2Complete = (extracted) => {
    setExtractedData(extracted)
    setStep(3)
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-8 fade-in">
        <h1 className="font-display text-3xl font-semibold text-navy-900">New Verification</h1>
        <p className="text-sm text-gray-400 mt-1">Upload documents, extract fields with AI, and run compliance checks.</p>
      </div>

      <StepIndicator current={step} steps={STEPS} />

      <div className="bg-white border border-[#E2E6EA] rounded-lg p-8 shadow-card fade-in-1">
        {step === 1 && !step1Done && <Step1 onComplete={handleStep1Complete} />}
        {step === 1 && step1Done && (
          <Step1Success caseRef={caseRef} files={uploadedFiles} onNext={() => setStep(2)} />
        )}
        {step === 2 && (
          <Step2 caseId={caseId} files={uploadedFiles} onComplete={handleStep2Complete} />
        )}
        {step === 3 && (
          <Step3 caseId={caseId} extractedData={extractedData} caseRef={caseRef} />
        )}
      </div>
    </div>
  )
}
