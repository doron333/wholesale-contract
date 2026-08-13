// Vercel Serverless Function — POST /api/signwell-webhook
//
// Receives SignWell document events. Register this URL in SignWell
// (Settings -> API -> Webhooks) as an API-type hook to also receive the
// SMS outcome events (document_sms_failed, document_sms_opted_out).
//
// Events of interest:
//   document_signed    - one recipient finished
//   document_completed - everyone signed; completed PDF available
//   document_declined  - someone refused
//   document_sms_failed / document_sms_opted_out - delivery problems

export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return res.status(400).json({ error: "Invalid JSON" }); }

  const event = body.event || {};
  const doc = (body.data && body.data.object) || {};
  const type = event.type || "unknown";

  // Structured log — visible in the Vercel dashboard under this function's logs.
  console.log(JSON.stringify({
    at: new Date().toISOString(),
    type,
    documentId: doc.id || null,
    documentName: doc.name || null,
    status: doc.status || null,
    signer: event.related_signer ? event.related_signer.name : null,
    recipient: event.related_recipient
      ? { name: event.related_recipient.name, phone: event.related_recipient.phone_number_masked,
          delivery: event.related_recipient.delivery_method }
      : null,
  }));

  if (type === "document_completed") {
    // Fetch the executed PDF URL for archiving. Left as a retrieval step so no
    // storage provider is assumed; the URL is in the log for now.
    const key = process.env.SIGNWELL_API_KEY;
    if (key && doc.id) {
      try {
        const r = await fetch(`https://www.signwell.com/api/v1/documents/${doc.id}/`, { headers: { "X-Api-Key": key } });
        if (r.ok) {
          const full = await r.json();
          console.log(JSON.stringify({ at: new Date().toISOString(), type: "completed_pdf", documentId: doc.id, url: full.completed_pdf_url || null }));
        }
      } catch (e) {
        console.log(JSON.stringify({ at: new Date().toISOString(), type: "completed_pdf_error", detail: String(e && e.message || e) }));
      }
    }
  }

  // Always 200 quickly so SignWell doesn't retry.
  return res.status(200).json({ received: true });
}
