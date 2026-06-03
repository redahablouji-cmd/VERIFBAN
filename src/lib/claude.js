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
  const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY
  const contentBlocks = []

  contentBlocks.push({
    type: 'text',
    text: 'Please analyze the following trade documents and extract all fields:',
  })

  for (const file of files) {
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

    contentBlocks.push({
      type: 'text',
      text: `\n--- Document: ${file.name} ---`,
    })

    if (isPdf) {
      try {
        const base64 = await readFileAsBase64(file)
        contentBlocks.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: base64,
          },
        })
      } catch {
        contentBlocks.push({
          type: 'text',
          text: '[PDF file - could not read binary content]',
        })
      }
    } else {
      try {
        const text = await readFileAsText(file)
        contentBlocks.push({ type: 'text', text })
      } catch {
        contentBlocks.push({
          type: 'text',
          text: '[Could not read file content]',
        })
      }
    }
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: contentBlocks }],
    }),
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(err.error?.message || `API error ${response.status}`)
  }

  const data = await response.json()
  const raw = data.content[0].text.trim()

  try {
    return JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    if (match) return JSON.parse(match[0])
    throw new Error('Could not parse AI response as JSON')
  }
}
