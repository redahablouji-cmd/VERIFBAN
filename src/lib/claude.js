const SYSTEM_PROMPT = `You are a trade finance document extraction engine for a Moroccan import payment verification system.

Analyze the provided trade documents and extract all available fields.

Return ONLY a valid JSON object with this exact structure. Use null for any field not found:

{
  "invoice": {
    "number": null,
    "date": null,
    "amount": null,
    "currency": null,
    "supplier": null,
    "buyer": null,
    "hsCode": null,
    "quantity": null,
    "unit": null,
    "description": null,
    "countryOfOrigin": null
  },
  "letterOfCredit": {
    "number": null,
    "amount": null,
    "currency": null,
    "beneficiary": null,
    "applicant": null,
    "expiryDate": null,
    "latestShipmentDate": null,
    "hsCode": null,
    "portOfLoading": null,
    "portOfDischarge": null
  },
  "billOfLading": {
    "number": null,
    "shipmentDate": null,
    "quantity": null,
    "unit": null,
    "portOfLoading": null,
    "portOfDischarge": null,
    "consignee": null,
    "shipper": null
  }
}

Return ONLY the JSON object. No explanation. No markdown. No backticks.`

async function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

async function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const base64 = e.target.result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export async function extractDocumentFields(files) {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY
  const parts = []

  parts.push({ text: 'Please analyze the following trade documents and extract all fields:' })

  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

    parts.push({ text: `\n--- Document: ${file.name} ---` })

    if (isPdf) {
      try {
        const base64 = await readFileAsBase64(file)
        parts.push({ inline_data: { mime_type: 'application/pdf', data: base64 } })
      } catch {
        parts.push({ text: '[PDF file - could not read binary content]' })
      }
    } else {
      try {
        const text = await readFileAsText(file)
        parts.push({ text })
      } catch {
        parts.push({ text: '[Could not read file content]' })
      }
    }
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048 },
      }),
    },
  )

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `Gemini API error ${response.status}`)
  }

  const data = await response.json()
  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

  if (!raw) throw new Error('Empty response from Gemini')

  try {
    return JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('Could not parse AI response as JSON')
  }
}
