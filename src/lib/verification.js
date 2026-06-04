function normalize(str) {
  if (!str) return ''
  return String(str).toLowerCase().replace(/[^a-z0-9]/g, '')
}

function fuzzyMatch(a, b) {
  if (!a || !b) return false
  const na = normalize(a)
  const nb = normalize(b)
  return na === nb || na.includes(nb) || nb.includes(na)
}

function parseAmount(str) {
  if (!str) return null
  const cleaned = String(str).replace(/[^0-9.]/g, '')
  const val = parseFloat(cleaned)
  return isNaN(val) ? null : val
}

function parseDate(str) {
  if (!str) return null
  const d = new Date(str)
  return isNaN(d.getTime()) ? null : d
}

export function runVerificationRules(extracted) {
  const inv = extracted?.invoice || {}
  const lc = extracted?.letterOfCredit || {}
  const bl = extracted?.billOfLading || {}
  const results = []

  // Rule 1 — Invoice amount matches L/C amount
  {
    const invAmt = parseAmount(inv.amount)
    const lcAmt = parseAmount(lc.amount)
    let status, note
    if (invAmt !== null && lcAmt !== null) {
      const diff = Math.abs(invAmt - lcAmt)
      const tol = lcAmt * 0.05
      if (diff <= tol) {
        status = 'pass'
        note = diff === 0 ? 'Exact match' : `Within 5% tolerance (diff: ${diff.toFixed(2)})`
      } else {
        status = 'fail'
        note = `Difference of ${diff.toFixed(2)} exceeds 5% tolerance`
      }
    } else {
      status = 'warning'
      note = 'One or both amounts not available'
    }
    results.push({
      category: 'Amount Consistency',
      check_name: 'Invoice amount matches L/C amount',
      expected_value: lc.amount ? String(lc.amount) : 'N/A',
      found_value: inv.amount ? String(inv.amount) : 'N/A',
      status,
      note,
    })
  }

  // Rule 2 — Currency match
  {
    const invCur = inv.currency?.toUpperCase()
    const lcCur = lc.currency?.toUpperCase()
    let status, note
    if (invCur && lcCur) {
      status = invCur === lcCur ? 'pass' : 'fail'
      note = status === 'pass' ? 'Currencies match' : `Invoice: ${invCur} / L/C: ${lcCur}`
    } else {
      status = 'warning'
      note = 'Currency not found in one or both documents'
    }
    results.push({
      category: 'Amount Consistency',
      check_name: 'Currency match',
      expected_value: lcCur || 'N/A',
      found_value: invCur || 'N/A',
      status,
      note,
    })
  }

  // Rule 3 — Supplier name matches L/C beneficiary
  {
    const supplier = inv.supplier
    const beneficiary = lc.beneficiary
    let status, note
    if (supplier && beneficiary) {
      status = fuzzyMatch(supplier, beneficiary) ? 'pass' : 'fail'
      note = status === 'pass' ? 'Names match' : 'Supplier and beneficiary names do not match'
    } else {
      status = 'warning'
      note = 'Supplier or beneficiary name not found'
    }
    results.push({
      category: 'Party Identity',
      check_name: 'Supplier name matches L/C beneficiary',
      expected_value: beneficiary || 'N/A',
      found_value: supplier || 'N/A',
      status,
      note,
    })
  }

  // Rule 4 — Buyer name matches L/C applicant
  {
    const buyer = inv.buyer
    const applicant = lc.applicant
    let status, note
    if (buyer && applicant) {
      status = fuzzyMatch(buyer, applicant) ? 'pass' : 'fail'
      note = status === 'pass' ? 'Names match' : 'Buyer and applicant names do not match'
    } else {
      status = 'warning'
      note = 'Buyer or applicant name not found'
    }
    results.push({
      category: 'Party Identity',
      check_name: 'Buyer name matches L/C applicant',
      expected_value: applicant || 'N/A',
      found_value: buyer || 'N/A',
      status,
      note,
    })
  }

  // Rule 5 — Invoice date within L/C validity window
  {
    const invDate = parseDate(inv.date)
    const expiry = parseDate(lc.expiryDate)
    let status, note
    if (invDate && expiry) {
      status = invDate <= expiry ? 'pass' : 'fail'
      if (status === 'fail') {
        const diffDays = Math.round((invDate.getTime() - expiry.getTime()) / 86400000)
        note = `Invoice dated ${diffDays} day${diffDays !== 1 ? 's' : ''} after L/C expiry`
      } else {
        note = 'Invoice date is within L/C validity'
      }
    } else {
      status = 'warning'
      note = 'Invoice date or L/C expiry not available'
    }
    results.push({
      category: 'Date Validity',
      check_name: 'Invoice date within L/C validity window',
      expected_value: lc.expiryDate || 'N/A',
      found_value: inv.date || 'N/A',
      status,
      note,
    })
  }

  // Rule 6 — Shipment date before L/C latest shipment date
  {
    const blDate = parseDate(bl.shipmentDate)
    const latestShip = parseDate(lc.latestShipmentDate)
    let status, note
    if (blDate && latestShip) {
      status = blDate <= latestShip ? 'pass' : 'fail'
      note = status === 'pass' ? 'Shipment date within L/C window' : 'Shipment date exceeds L/C latest shipment date'
    } else {
      status = 'warning'
      note = 'Shipment date or L/C latest shipment date not available'
    }
    results.push({
      category: 'Date Validity',
      check_name: 'Shipment date before L/C latest shipment date',
      expected_value: lc.latestShipmentDate || 'N/A',
      found_value: bl.shipmentDate || 'N/A',
      status,
      note,
    })
  }

  // Rule 7 — HS code consistent
  {
    const invHS = inv.hsCode?.trim()
    const lcHS = lc.hsCode?.trim()
    let status, note
    if (invHS && lcHS) {
      status = invHS === lcHS ? 'pass' : 'fail'
      note = status === 'pass' ? 'HS codes match' : `Invoice: ${invHS} / L/C: ${lcHS}`
    } else {
      status = 'warning'
      note = 'HS code not found in one or both documents'
    }
    results.push({
      category: 'Goods Description',
      check_name: 'HS code consistent across documents',
      expected_value: lcHS || 'N/A',
      found_value: invHS || 'N/A',
      status,
      note,
    })
  }

  // Rule 8 — Quantity matches
  {
    const invQty = parseFloat(inv.quantity)
    const blQty = parseFloat(bl.quantity)
    let status, note
    if (!isNaN(invQty) && !isNaN(blQty)) {
      const maxVal = Math.max(invQty, blQty)
      const diff = Math.abs(invQty - blQty)
      status = maxVal > 0 && diff / maxVal < 0.02 ? 'pass' : 'fail'
      note = status === 'pass'
        ? 'Quantities match within 2% tolerance'
        : `Difference of ${diff.toFixed(2)} (${((diff / maxVal) * 100).toFixed(1)}%)`
    } else {
      status = 'warning'
      note = 'Quantity not found in one or both documents'
    }
    results.push({
      category: 'Goods Description',
      check_name: 'Quantity matches between invoice and B/L',
      expected_value: bl.quantity ? String(bl.quantity) : 'N/A',
      found_value: inv.quantity ? String(inv.quantity) : 'N/A',
      status,
      note,
    })
  }

  // Rule 9 — Port of loading matches
  {
    const blPOL = bl.portOfLoading
    const lcPOL = lc.portOfLoading
    let status, note
    if (blPOL && lcPOL) {
      status = fuzzyMatch(blPOL, lcPOL) ? 'pass' : 'fail'
      note = status === 'pass' ? 'Ports of loading match' : `B/L: ${blPOL} / L/C: ${lcPOL}`
    } else {
      status = 'warning'
      note = 'Port of loading not found in one or both documents'
    }
    results.push({
      category: 'Port and Shipping',
      check_name: 'Port of loading matches L/C',
      expected_value: lcPOL || 'N/A',
      found_value: blPOL || 'N/A',
      status,
      note,
    })
  }

  // Rule 10 — Port of discharge matches
  {
    const blPOD = bl.portOfDischarge
    const lcPOD = lc.portOfDischarge
    let status, note
    if (blPOD && lcPOD) {
      status = fuzzyMatch(blPOD, lcPOD) ? 'pass' : 'fail'
      note = status === 'pass' ? 'Ports of discharge match' : `B/L: ${blPOD} / L/C: ${lcPOD}`
    } else {
      status = 'warning'
      note = 'Port of discharge not found in one or both documents'
    }
    results.push({
      category: 'Port and Shipping',
      check_name: 'Port of discharge matches L/C',
      expected_value: lcPOD || 'N/A',
      found_value: blPOD || 'N/A',
      status,
      note,
    })
  }

  const passCount = results.filter((r) => r.status === 'pass').length
  const failCount = results.filter((r) => r.status === 'fail').length
  const warnCount = results.filter((r) => r.status === 'warning').length
  const overallResult = failCount === 0 ? 'pass' : 'fail'

  return { results, passCount, failCount, warnCount, overallResult }
}
