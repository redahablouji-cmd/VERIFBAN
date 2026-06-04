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
// Helpers
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

function detectTypeFromFilename(name) {
  const n = name.toLowerCase()
  if (n.includes('invoice') || n.includes('inv')) return 'invoice'
  if (n.includes('lc') || n.includes('letter') || n.includes('credit')) return 'letter_of_credit'
  if (n.includes('bl') || n.includes('lading') || n.includes('bill')) return 'bill_of_lading'
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Quality check — size, valid PDF magic bytes, text-layer presence
// ─────────────────────────────────────────────────────────────────────────────
async function runQualityCheck(file) {
  const ext = file.name.split('.').pop().toLowerCase()

  if (!['pdf', 'txt', 'docx'].includes(ext)) {
    return { status: 'fail', message: `File type .${ext} is not accepted. Use PDF, TXT, or DOCX.` }
  }
  if (file.size < 5000) {
    return { status: 'fail', message: 'File too small — may be empty or corrupt' }
  }
  if (file.size > 50 * 1024 * 1024) {
    return { status: 'fail', message: 'File exceeds 50 MB limit' }
  }

  if (ext === 'pdf' || file.type === 'application/pdf') {
    try {
      const buf = await file.slice(0, 5).arrayBuffer()
      const magic = String.fromCharCode(...new Uint8Array(buf))
      if (!magic.startsWith('%PDF')) {
        return { status: 'fail', message: 'Not a valid PDF — file may be corrupt or mislabelled' }
      }
    } catch {
      return { status: 'fail', message: 'Could not read file header' }
    }

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
          message: 'PDF has no text layer (scan-only image) — AI cannot read it. Please use a searchable PDF.',
        }
      }
    } catch { /* skip text-layer check on read failure */ }
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
// Step 1 — Document Intake
// ─────────────────────────────────────────────────────────────────────────────
function Step1({ onComplete }) {
  const [clientName, setClientName] = useState('')
  const [slots, setSlots] = useState({
    invoice:          { file: null, qc: null, qcMessage: '', mismatch: false },
    letter_of_credit: { file: null, qc: null, qcMessage: '', mismatch: false },
    bill_of_lading:   { file: null, qc: null, qcMessage: '', mismatch: false },
  })
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const fileRefs = useRef({})

  const handleFileChange = async (docType, file) => {
    if (!file) return
    const detectedType = detectTypeFromFilename(file.name)
    const mismatch = detectedType !== null && detectedType !== docType
    setSlots((prev) => ({ ...prev, [docType]: { file, qc: 'checking', qcMessage: '', mismatch } }))
    const result = await runQualityCheck(file)
    setSlots((prev) => ({ ...prev, [docType]: { file, qc: result.status, qcMessage: result.message, mismatch } }))
  }

  const removeSlot = (docType) => {
    setSlots((prev) => ({ ...prev, [docType]: { file: null, qc: null, qcMessage: '', mismatch: false } }))
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
      const fileEntries = REQUIRED_DOCS
        .map(({ type }) => ({ file: slots[type].file, type }))
        .filter(({ file }) => file !== null)

      const { data: caseRow, error: caseErr } = await supabase
        .from('cases')
        .insert({
          case_ref: caseRef,
          client_name: clientName.trim(),
          status: 'pending_extraction',
          file_count: fileEntries.length,
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

      for (const { file, type } of fileEntries) {
        const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `cases/${caseRef}/${type}/${safeName}`

        const { error: uploadErr } = await supabase.storage
          .from('trade-documents')
          .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: true })

        if (uploadErr && !uploadErr.message?.includes('already exists')) {
          console.warn('Storage upload warning:', uploadErr.message)
        }

        await supabase.from('documents').insert({
          case_id: caseRow.id,
          file_name: file.name,
          file_type: type,
          storage_path: path,
        })
      }

      onComplete({ caseId: caseRow.id, caseRef, fileEntries, clientName: clientName.trim() })
    } catch (err) {
      setError(err.message || 'Failed to create case.')
      setSubmitting(false)
    }
  }

  const slotLabelFor = (type) => REQUIRED_DOCS.find((d) => d.type === type)?.label || type

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-navy-900 mb-1">Document Intake</h2>
      <p className="text-sm text-gray-400 mb-8">Upload all three required trade documents to proceed.</p>

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

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-navy-900">Required Documents</h3>
          <span className="text-xs text-gray-400 tabular-nums">{readyCount} / 3 ready</span>
        </div>

        <div className="space-y-3">
          {REQUIRED_DOCS.map(({ type, label, description, hint }, idx) => {
            const { file, qc, qcMessage, mismatch } = slots[type]
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

                    {/* Mismatch warning */}
                    {file && mismatch && qc !== 'fail' && (
                      <div className="mt-2 flex items-start gap-1.5">
                        <svg className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                        <p className="text-xs text-amber-700">This file may not be a {label} based on its filename — please verify before continuing</p>
                      </div>
                    )}

                    {qc === 'pass' && !mismatch && (
                      <p className="text-xs text-emerald-600 font-medium mt-1.5">✓ Quality check passed</p>
                    )}
                    {qc === 'pass' && mismatch && (
                      <p className="text-xs text-emerald-600 font-medium mt-1">✓ Quality check passed (verify document type above)</p>
                    )}
                    {qc === 'fail' && (
                      <p className="text-xs text-red-600 font-medium mt-1.5">✗ {qcMessage}</p>
                    )}
                    {qc === 'checking' && (
                      <p className="text-xs text-gray-400 mt-1.5">Checking quality…</p>
                    )}
                  </div>

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
// Step 1 Success
// ─────────────────────────────────────────────────────────────────────────────
function Step1Success({ caseRef, fileEntries, onNext }) {
  const labelFor = (type) => REQUIRED_DOCS.find((d) => d.type === type)?.label || type
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
        {fileEntries.map(({ file, type }) => (
          <div key={type} className="px-5 py-3 flex items-center gap-3">
            <svg className="w-4 h-4 text-emerald-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span className="text-sm text-navy-900 flex-1 truncate">{file.name}</span>
            <span className="text-xs text-gray-400">{labelFor(type)}</span>
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
const CRITICAL_FIELDS = [
  { docType: 'invoice',        field: 'amount',     label: 'Invoice Amount' },
  { docType: 'invoice',        field: 'currency',   label: 'Invoice Currency' },
  { docType: 'invoice',        field: 'supplier',   label: 'Supplier' },
  { docType: 'invoice',        field: 'buyer',      label: 'Buyer' },
  { docType: 'letterOfCredit', field: 'amount',     label: 'L/C Amount' },
  { docType: 'letterOfCredit', field: 'currency',   label: 'L/C Currency' },
  { docType: 'letterOfCredit', field: 'expiryDate', label: 'L/C Expiry Date' },
]

const DOC_TYPE_DISPLAY = { invoice: 'Invoice', letterOfCredit: 'Letter of Credit', billOfLading: 'Bill of Lading' }

function Step2({ caseId, fileEntries, onComplete }) {
  const [status, setStatus] = useState('idle')
  const [extracted, setExtracted] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')

  const run = async () => {
    setStatus('running')
    try {
      await supabase.from('cases').update({ status: 'extracting' }).eq('id', caseId)

      const data = await extractDocumentFields(fileEntries)
      setExtracted(data)

      // Save ALL fields: non-null = 'high', null = 'low'
      const rows = []
      for (const [docType, fields] of Object.entries(data)) {
        if (!fields) continue
        for (const [fieldName, fieldValue] of Object.entries(fields)) {
          rows.push({
            case_id: caseId,
            doc_type: docType,
            field_name: fieldName,
            field_value: fieldValue !== null ? String(fieldValue) : null,
            confidence: fieldValue !== null ? 'high' : 'low',
          })
        }
      }
      if (rows.length > 0) await supabase.from('extracted_fields').insert(rows)

      await supabase.from('cases').update({ status: 'extracted' }).eq('id', caseId)
      setStatus('done')
    } catch (err) {
      setErrorMsg(err.message || 'Extraction failed — document may be unreadable')
      await supabase.from('cases').update({ status: 'failed' }).eq('id', caseId)
      setStatus('error')
    }
  }

  const totalFields = extracted
    ? Object.values(extracted).reduce((s, f) => s + Object.keys(f || {}).length, 0)
    : 0
  const extractedCount = extracted
    ? Object.values(extracted).reduce((s, f) => s + Object.values(f || {}).filter((v) => v !== null).length, 0)
    : 0
  const missingCritical = extracted
    ? CRITICAL_FIELDS.filter(({ docType, field }) => extracted[docType]?.[field] === null)
    : []

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
          <div className="relative w-12 h-12">
            <div className="w-12 h-12 border-2 border-[#E2E6EA] rounded-full" />
            <div className="absolute inset-0 w-12 h-12 border-2 border-navy-900 border-t-transparent rounded-full animate-spin" />
          </div>
          <p className="text-sm font-medium text-navy-900">Reading documents with AI…</p>
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
          {/* Summary bar */}
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 bg-emerald-100 rounded-full flex items-center justify-center">
                <svg className="w-3 h-3 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <p className="text-sm font-semibold text-emerald-700">Extraction complete</p>
            </div>
            <span className="text-xs font-medium text-gray-500 bg-[#F7F8FA] border border-[#E2E6EA] rounded px-3 py-1">
              {extractedCount} of {totalFields} fields extracted
            </span>
          </div>

          {/* Critical field warnings */}
          {missingCritical.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg px-5 py-4 mb-5">
              <p className="text-sm font-semibold text-red-800 mb-2">Critical field missing — verification may be incomplete</p>
              <ul className="space-y-1">
                {missingCritical.map(({ label }) => (
                  <li key={label} className="text-xs text-red-700 flex items-center gap-1.5">
                    <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    {label} not detected
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Extracted fields grouped by document type */}
          <div className="space-y-4 mb-8">
            {Object.entries(extracted).map(([docType, fields]) => {
              if (!fields) return null
              return (
                <div key={docType} className="bg-white border border-[#E2E6EA] rounded-lg overflow-hidden">
                  <div className="px-5 py-3 bg-[#F7F8FA] border-b border-[#E2E6EA]">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      {DOC_TYPE_DISPLAY[docType] || docType}
                    </span>
                  </div>
                  <div className="divide-y divide-[#E2E6EA]">
                    {Object.entries(fields).map(([key, val]) => (
                      <div key={key} className="px-5 py-3 flex justify-between gap-4">
                        <span className="text-sm text-gray-400 capitalize">
                          {key.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                        {val !== null ? (
                          <span className="text-sm font-medium text-navy-900 text-right">{String(val)}</span>
                        ) : (
                          <span className="text-sm text-gray-300 italic">Not detected</span>
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
    <div className={`px-5 py-4 flex items-start justify-between gap-4 ${
      isFail ? 'border-l-2 border-red-500 bg-red-50' :
      isWarn ? 'border-l-2 border-amber-400 bg-amber-50/40' : ''
    }`}>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-navy-900">{result.check_name}</p>
        <div className="flex flex-wrap gap-x-6 mt-1">
          <span className="text-xs text-gray-400">Expected: <span className="text-navy-700">{result.expected_value}</span></span>
          <span className="text-xs text-gray-400">Found: <span className="text-navy-700">{result.found_value}</span></span>
        </div>
        {result.note && <p className="text-xs text-gray-400 mt-0.5 italic">{result.note}</p>}
      </div>
      <Badge status={result.status} />
    </div>
  )
}

function generateNotifyMessage(caseRef, clientName, failedChecks) {
  const list = failedChecks
    .map((r, i) =>
      `${i + 1}. ${r.check_name}\n   Expected : ${r.expected_value}\n   Found    : ${r.found_value}${r.note ? `\n   Note     : ${r.note}` : ''}`
    )
    .join('\n\n')

  return `Dear ${clientName || 'Client'},

Following our review of your import payment documentation for case ${caseRef}, we have identified the following discrepancies that require your immediate attention:

${list}

Please review and resubmit the corrected documentation at your earliest convenience. Our compliance team remains available to assist you.

Regards,
VerifyTrade Compliance Operations`
}

function NotifyModal({ caseRef, clientName, failedChecks, onClose }) {
  const [copied, setCopied] = useState(false)
  const message = generateNotifyMessage(caseRef, clientName, failedChecks)

  const handleCopy = () => {
    navigator.clipboard.writeText(message).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      const el = document.createElement('textarea')
      el.value = message
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="fixed inset-0 bg-navy-900/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full flex flex-col max-h-[85vh]">
        <div className="px-6 py-4 border-b border-[#E2E6EA] flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-display text-lg font-semibold text-navy-900">Client Notification</h3>
            <p className="text-xs text-gray-400 mt-0.5">{failedChecks.length} discrepanc{failedChecks.length !== 1 ? 'ies' : 'y'} to notify</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1">
          <pre className="text-sm text-navy-700 whitespace-pre-wrap font-sans leading-relaxed bg-[#F7F8FA] border border-[#E2E6EA] rounded p-4">
            {message}
          </pre>
        </div>
        <div className="px-6 py-4 border-t border-[#E2E6EA] flex gap-3 shrink-0">
          <button
            onClick={handleCopy}
            className="inline-flex items-center gap-2 bg-navy-900 text-white text-sm font-medium px-5 py-2 rounded hover:bg-navy-800 transition-colors"
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Copied
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy Message
              </>
            )}
          </button>
          <button
            onClick={onClose}
            className="border border-[#E2E6EA] text-navy-700 text-sm font-medium px-5 py-2 rounded hover:bg-gray-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  )
}

function Step3({ caseId, caseRef, clientName, extractedData }) {
  const navigate = useNavigate()
  const [status, setStatus] = useState('idle')
  const [verificationData, setVerificationData] = useState(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [bankStatus, setBankStatus] = useState(null) // null | 'sending' | 'sent'
  const [showNotifyModal, setShowNotifyModal] = useState(false)

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

  const handleSendToBank = async () => {
    setBankStatus('sending')
    await supabase.from('cases').update({ status: 'queued' }).eq('id', caseId)
    setBankStatus('sent')
  }

  const groupedResults = verificationData ? groupBy(verificationData.results, 'category') : {}
  const isPassed = verificationData?.overallResult === 'pass'
  const total = verificationData
    ? verificationData.passCount + verificationData.failCount + verificationData.warnCount
    : 0
  const failedChecks = verificationData?.results.filter((r) => r.status === 'fail') || []

  return (
    <div>
      <h2 className="font-display text-2xl font-semibold text-navy-900 mb-1">Verification</h2>
      <p className="text-sm text-gray-400 mb-8">Automatically cross-check all 10 document compliance rules.</p>

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
          <div className="relative w-12 h-12">
            <div className="w-12 h-12 border-2 border-[#E2E6EA] rounded-full" />
            <div className="absolute inset-0 w-12 h-12 border-2 border-navy-900 border-t-transparent rounded-full animate-spin" />
          </div>
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
          {/* Stat boxes */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Checks', val: total,                        cls: 'text-navy-900' },
              { label: 'Passed',       val: verificationData.passCount,   cls: 'text-emerald-600' },
              { label: 'Failed',       val: verificationData.failCount,   cls: 'text-red-600' },
              { label: 'Review',       val: verificationData.warnCount,   cls: 'text-amber-600' },
            ].map(({ label, val, cls }) => (
              <div key={label} className="bg-white border border-[#E2E6EA] rounded-lg p-4 text-center shadow-card">
                <p className={`font-display text-2xl font-semibold ${cls}`}>{val}</p>
                <p className="text-xs text-gray-400 mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Verdict banner */}
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

          {/* Rule results grouped by category */}
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

          {/* Action buttons */}
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleSendToBank}
              disabled={!isPassed || bankStatus !== null}
              className="inline-flex items-center gap-2 bg-emerald-600 text-white text-sm font-medium px-5 py-2.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-emerald-700"
            >
              {bankStatus === 'sending' ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Sending…
                </>
              ) : bankStatus === 'sent' ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                  Sent to Bank Queue
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14m-7-7l7 7-7 7" />
                  </svg>
                  Send to Bank Queue
                </>
              )}
            </button>

            <button
              onClick={() => setShowNotifyModal(true)}
              disabled={isPassed}
              className="inline-flex items-center gap-2 bg-red-600 text-white text-sm font-medium px-5 py-2.5 rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-red-700"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
              Notify Client of Discrepancies
            </button>

            <button
              onClick={() => navigate(`/cases/${caseId}`)}
              className="inline-flex items-center gap-2 border border-[#E2E6EA] text-navy-700 text-sm font-medium px-5 py-2.5 rounded hover:bg-gray-50 transition-colors"
            >
              View Case Report
            </button>
          </div>

          {showNotifyModal && (
            <NotifyModal
              caseRef={caseRef}
              clientName={clientName}
              failedChecks={failedChecks}
              onClose={() => setShowNotifyModal(false)}
            />
          )}
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
  const [clientName, setClientName] = useState('')
  const [fileEntries, setFileEntries] = useState([])
  const [step1Done, setStep1Done] = useState(false)
  const [extractedData, setExtractedData] = useState(null)

  const handleStep1Complete = ({ caseId: id, caseRef: ref, fileEntries: entries, clientName: name }) => {
    setCaseId(id)
    setCaseRef(ref)
    setFileEntries(entries)
    setClientName(name)
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
          <Step1Success caseRef={caseRef} fileEntries={fileEntries} onNext={() => setStep(2)} />
        )}
        {step === 2 && (
          <Step2 caseId={caseId} fileEntries={fileEntries} onComplete={handleStep2Complete} />
        )}
        {step === 3 && (
          <Step3 caseId={caseId} caseRef={caseRef} clientName={clientName} extractedData={extractedData} />
        )}
      </div>
    </div>
  )
}
