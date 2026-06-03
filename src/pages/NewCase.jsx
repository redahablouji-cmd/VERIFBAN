import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase.js'
import { extractDocumentFields } from '../lib/claude.js'
import { runVerificationRules } from '../lib/verification.js'
import { generateCaseRef } from '../lib/caseRef.js'
import StepIndicator from '../components/StepIndicator.jsx'
import Badge from '../components/Badge.jsx'

const STEPS = ['Document Intake', 'AI Extraction', 'Verification']

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function detectDocType(name) {
  const n = name.toLowerCase()
  if (n.includes('invoice') || n.includes('inv')) return 'invoice'
  if (n.includes('lc') || n.includes('letter') || n.includes('credit')) return 'letter_of_credit'
  if (n.includes('bl') || n.includes('lading') || n.includes('bill')) return 'bill_of_lading'
  return 'other'
}

function docTypeLabel(type) {
  return {
    invoice: 'Commercial Invoice',
    letter_of_credit: 'Letter of Credit',
    bill_of_lading: 'Bill of Lading',
    other: 'Trade Document',
  }[type] || 'Trade Document'
}

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
// Step 1 — Document Intake
// ─────────────────────────────────────────────────────────────────────────────
function Step1({ onComplete }) {
  const [clientName, setClientName] = useState('')
  const [files, setFiles] = useState([])
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inputRef = useRef(null)

  const addFiles = useCallback((newFiles) => {
    const valid = Array.from(newFiles).filter((f) => {
      const ext = f.name.split('.').pop().toLowerCase()
      return ['pdf', 'txt', 'docx'].includes(ext)
    })
    setFiles((prev) => {
      const existing = new Set(prev.map((f) => f.name))
      return [...prev, ...valid.filter((f) => !existing.has(f.name))]
    })
  }, [])

  const onDrop = useCallback(
    (e) => {
      e.preventDefault()
      setDragging(false)
      addFiles(e.dataTransfer.files)
    },
    [addFiles],
  )

  const removeFile = (name) => setFiles((prev) => prev.filter((f) => f.name !== name))

  const handleSubmit = async () => {
    if (!clientName.trim()) { setError('Please enter a client name.'); return }
    if (files.length === 0) { setError('Please upload at least one document.'); return }
    setError('')
    setSubmitting(true)

    try {
      const caseRef = generateCaseRef()

      // Insert case
      const { data: caseRow, error: caseErr } = await supabase
        .from('cases')
        .insert({
          case_ref: caseRef,
          client_name: clientName.trim(),
          status: 'pending_extraction',
          file_count: files.length,
          pass_count: 0,
          fail_count: 0,
          warn_count: 0,
          overall_result: 'pending',
        })
        .select()
        .single()

      if (caseErr) throw caseErr

      // Upload files + insert document rows
      await Promise.all(
        files.map(async (file) => {
          const path = `cases/${caseRef}/${file.name}`
          await supabase.storage.from('trade-documents').upload(path, file, {
            contentType: file.type,
            upsert: true,
          })
          await supabase.from('documents').insert({
            case_id: caseRow.id,
            file_name: file.name,
            file_type: detectDocType(file.name),
            storage_path: path,
          })
        }),
      )

      onComplete({ caseId: caseRow.id, caseRef, files })
    } catch (err) {
      setError(err.message || 'Failed to create case.')
      setSubmitting(false)
    }
  }

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-navy-900 mb-1">Document Intake</h2>
      <p className="text-sm text-gray-400 mb-8">Enter client details and upload trade documents.</p>

      {/* Client name */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-navy-700 mb-2">Client Name</label>
        <input
          type="text"
          value={clientName}
          onChange={(e) => setClientName(e.target.value)}
          placeholder="e.g. Moroccan Import Co."
          className="w-full max-w-md border border-[#E2E6EA] rounded px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-navy-900 focus:border-transparent bg-white"
        />
      </div>

      {/* Drop zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors mb-6 ${
          dragging ? 'border-navy-900 bg-navy-50' : 'border-[#E2E6EA] hover:border-navy-300 hover:bg-gray-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.docx"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="flex flex-col items-center gap-3">
          <div className="w-12 h-12 bg-navy-50 rounded-full flex items-center justify-center">
            <svg className="w-6 h-6 text-navy-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-navy-900">Drop files here or click to browse</p>
            <p className="text-xs text-gray-400 mt-1">PDF, TXT, DOCX accepted</p>
          </div>
        </div>
      </div>

      {/* File list */}
      {files.length > 0 && (
        <div className="bg-white border border-[#E2E6EA] rounded-lg divide-y divide-[#E2E6EA] mb-6">
          {files.map((file) => (
            <div key={file.name} className="px-5 py-3.5 flex items-center gap-4">
              <div className="w-8 h-8 bg-navy-50 rounded flex items-center justify-center shrink-0">
                <svg className="w-4 h-4 text-navy-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-navy-900 truncate">{file.name}</p>
                <p className="text-xs text-gray-400">{docTypeLabel(detectDocType(file.name))} · {formatSize(file.size)}</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); removeFile(file.name) }}
                className="text-gray-300 hover:text-red-500 transition-colors p-1"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-6 py-2.5 rounded hover:bg-navy-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? 'Creating case…' : 'Create Case & Upload Documents'}
        {!submitting && (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        )}
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 Success panel (shown after case created, before step 2)
// ─────────────────────────────────────────────────────────────────────────────
function Step1Success({ caseRef, files, onNext }) {
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
        {files.map((file) => (
          <div key={file.name} className="px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-navy-900">{file.name}</span>
            <span className="text-xs text-gray-400 ml-auto">{docTypeLabel(detectDocType(file.name))}</span>
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
  const [status, setStatus] = useState('idle') // idle | running | done | error
  const [extracted, setExtracted] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  const run = async () => {
    setStatus('running')
    try {
      // Update status to extracting
      await supabase.from('cases').update({ status: 'extracting' }).eq('id', caseId)

      // Extract
      const data = await extractDocumentFields(files)
      setExtracted(data)

      // Save fields to DB
      const rows = []
      for (const [docType, fields] of Object.entries(data)) {
        if (!fields) continue
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
          if (fieldValue !== null && fieldValue !== undefined) {
            rows.push({
              case_id: caseId,
              doc_type: docType,
              field_name: fieldName,
              field_value: String(fieldValue),
              confidence: 'high',
            })
          }
        }
      }
      if (rows.length > 0) {
        await supabase.from('extracted_fields').insert(rows)
      }

      // Update status
      await supabase.from('cases').update({ status: 'extracted' }).eq('id', caseId)
      setStatus('done')
    } catch (err) {
      setErrorMsg(err.message || 'Extraction failed.')
      await supabase.from('cases').update({ status: 'failed' }).eq('id', caseId)
      setStatus('error')
    }
  }

  const docTypeDisplay = {
    invoice: 'Invoice',
    letterOfCredit: 'Letter of Credit',
    billOfLading: 'Bill of Lading',
  }

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-navy-900 mb-1">AI Extraction</h2>
      <p className="text-sm text-gray-400 mb-8">Extract structured fields from your documents using AI.</p>

      {status === 'idle' && (
        <button
          onClick={run}
          className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-6 py-2.5 rounded hover:bg-navy-800 transition-colors"
        >
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
              const entries = Object.entries(fields)
              return (
                <div key={docType} className="bg-white border border-[#E2E6EA] rounded-lg overflow-hidden">
                  <div className="px-5 py-3 bg-[#F7F8FA] border-b border-[#E2E6EA]">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {docTypeDisplay[docType] || docType}
                    </span>
                  </div>
                  <div className="divide-y divide-[#E2E6EA]">
                    {entries.map(([key, val]) => (
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
    <div
      className={`px-5 py-4 flex items-start justify-between gap-4 ${
        isFail ? 'border-l-2 border-red-500 bg-red-50' : isWarn ? 'bg-amber-50/40' : ''
      }`}
    >
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

function Step3({ caseId, extractedData, caseRef }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState('idle')
  const [verificationData, setVerificationData] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  const run = async () => {
    setStatus('running')
    try {
      const { results, passCount, failCount, warnCount, overallResult } = runVerificationRules(extractedData)

      // Save to DB
      const rows = results.map((r) => ({ ...r, case_id: caseId }))
      await supabase.from('verification_results').insert(rows)

      // Update case
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
        <button
          onClick={run}
          className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-6 py-2.5 rounded hover:bg-navy-800 transition-colors"
        >
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
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Checks', val: total, cls: 'text-navy-900' },
              { label: 'Passed', val: verificationData.passCount, cls: 'text-emerald-600' },
              { label: 'Failed', val: verificationData.failCount, cls: 'text-red-600' },
              { label: 'Review', val: verificationData.warnCount, cls: 'text-amber-600' },
            ].map(({ label, val, cls }) => (
              <div key={label} className="bg-white border border-[#E2E6EA] rounded-lg p-4 text-center shadow-card">
                <p className={`font-display text-2xl font-semibold ${cls}`}>{val}</p>
                <p className="text-xs text-gray-400 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Verdict */}
          <div
            className={`rounded-lg px-5 py-4 mb-6 flex items-center gap-3 ${
              isPassed ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'
            }`}
          >
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 ${
                isPassed ? 'bg-emerald-600' : 'bg-red-600'
              }`}
            >
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

          {/* Rule results */}
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

  const handleGoToStep2 = () => setStep(2)

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
          <Step1Success caseRef={caseRef} files={uploadedFiles} onNext={handleGoToStep2} />
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
