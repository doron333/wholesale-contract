// Vercel Serverless Function — POST /api/parse
// Extracts structured wholesale-deal fields from free-form notes using the Anthropic API.
// The API key is read from the ANTHROPIC_API_KEY environment variable (set in the Vercel
// dashboard). It is NEVER hardcoded or committed. PDF fill/export happens client-side and
// does not require this function; it only powers the "smart Autofill" button.

const MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";

const SYSTEM = `You extract structured fields from messy real-estate wholesale deal notes.
Return ONLY a JSON object (no prose, no markdown fences) with exactly these keys:
{
  "seller": "",       // seller / homeowner full name
  "seller2": "",      // second seller / co-owner ("" if only one)
  "buyer": "",        // buyer entity (leave "" unless clearly stated)
  "signer": "",       // buyer signer person (leave "" unless stated)
  "assignee": "",     // end cash buyer for the assignment (leave "" if not mentioned)
  "address": "",      // full street address of the property
  "muni": "",         // municipality / town
  "county": "",       // county
  "agrDate": "",      // agreement date as YYYY-MM-DD ("" if not stated)
  "closeDate": "",    // closing date as YYYY-MM-DD ("" if not stated)
  "price": "",        // purchase price, digits only, no $ or commas
  "emd": "",          // earnest money / deposit, digits only, no $ or commas
  "title": "",        // title / escrow company
  "inspDays": "",     // inspection period in business days ("" if not stated)
  "phone": "",        // seller phone
  "email": "",        // seller email
  "sellerAddr": "",   // seller mailing address for notices
  "buyerAddr": "",    // buyer mailing address for notices
  "buyerPhone": "",   // buyer phone
  "buyerEmail": ""    // buyer email
}
Rules: use "" for anything not present. Never invent values. Interpret "285k" as 285000.
Dates must be ISO YYYY-MM-DD; if only a month/day with no year is given, assume the current year.`;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    // 501 signals the client to fall back to its local regex parser.
    return res.status(501).json({ error: "ANTHROPIC_API_KEY not configured" });
  }

  let notes = "";
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    notes = (body.notes || "").toString().slice(0, 8000);
  } catch (_) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }
  if (!notes.trim()) return res.status(400).json({ error: "No notes provided" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system: SYSTEM,
        messages: [{ role: "user", content: notes }],
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: "Anthropic API error", status: r.status, detail: detail.slice(0, 500) });
    }

    const data = await r.json();
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text.replace(/^```json\s*|^```\s*|\s*```$/g, "").trim());
    } catch (_) {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return res.status(502).json({ error: "Model did not return JSON", raw: text.slice(0, 500) });
      parsed = JSON.parse(m[0]);
    }

    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "Server error", detail: String(e && e.message || e).slice(0, 500) });
  }
}
