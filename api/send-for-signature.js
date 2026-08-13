// Vercel Serverless Function — POST /api/send-for-signature
//
// Sends a filled PDF to SignWell for signature. The API key lives in the
// SIGNWELL_API_KEY environment variable and never reaches the browser.
//
// Signature field coordinates below were measured directly from the templates
// (true typographic baselines), so signature boxes land on the actual lines.
//
// SignWell field coords are "pixels" from the top-left of each page. For a
// Letter page rendered at 72dpi this equals PDF points 1:1. If placement is off
// on the first test send, tune SIGNWELL_COORD_SCALE rather than editing code.

const API = "https://www.signwell.com/api/v1/documents";
const SCALE = parseFloat(process.env.SIGNWELL_COORD_SCALE || "1");
const s = (v) => Math.round(v * SCALE * 100) / 100;

const SIG_H = 30;   // signature box height
const SIG_W = 190;  // signature box width
const DT_H = 16;    // date box height
const DT_W = 110;   // date box width

// --- Purchase contract: signature page is page 6 -------------------------
// Baselines: seller line 173.59, seller date 215.29, seller2 line 262.89,
// seller2 date 304.59, buyer line 359.49, buyer date 414.79
function contractFields({ sellerId, seller2Id, buyerId }) {
  const f = [];
  const block = (rid, sigBase, sigX, dtBase, dtX) => {
    f.push({ x: s(sigX), y: s(sigBase - SIG_H), page: 6, recipient_id: rid,
             type: "signature", required: true, width: s(SIG_W), height: s(SIG_H) });
    f.push({ x: s(dtX), y: s(dtBase - DT_H), page: 6, recipient_id: rid,
             type: "date", required: true, width: s(DT_W), height: s(DT_H),
             lock_sign_date: true, date_format: "MM/DD/YYYY" });
  };
  block(sellerId, 173.59, 112, 215.29, 104);
  if (seller2Id) block(seller2Id, 262.89, 112, 304.59, 104);
  block(buyerId, 359.49, 114, 414.79, 301);
  return f;
}

// --- Assignment of contract: single page ---------------------------------
// Assignee line baseline 551.8 (x 44.9-236.9), date x 239.9
// Assignor line baseline 606.0
function assignmentFields({ assigneeId, assignorId }) {
  const f = [];
  const block = (rid, base) => {
    f.push({ x: s(48), y: s(base - SIG_H), page: 1, recipient_id: rid,
             type: "signature", required: true, width: s(180), height: s(SIG_H) });
    f.push({ x: s(243), y: s(base - DT_H), page: 1, recipient_id: rid,
             type: "date", required: true, width: s(DT_W), height: s(DT_H),
             lock_sign_date: true, date_format: "MM/DD/YYYY" });
  };
  block(assigneeId, 551.8);
  block(assignorId, 606.0);
  return f;
}

const e164 = (p) => {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d[0] === "1") return "+" + d;
  return null;
};

function buildRecipient(r, idx) {
  const phone = e164(r.phone);
  const out = { id: String(idx + 1), name: r.name };
  if (r.email) out.email = r.email;
  if (phone && r.email) { out.delivery_method = "email_and_sms"; out.phone_number = phone; }
  else if (phone) { out.delivery_method = "sms"; out.phone_number = phone; }
  else out.delivery_method = "email";
  return out;
}

async function callSignWell(key, payload) {
  const r = await fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": key },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  return { ok: r.ok, status: r.status, json };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "Method not allowed" }); }
  const key = process.env.SIGNWELL_API_KEY;
  if (!key) return res.status(501).json({ error: "SIGNWELL_API_KEY not configured" });

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {}); }
  catch { return res.status(400).json({ error: "Invalid JSON body" }); }

  const { kind, pdfBase64, fileName, signers, testMode, docName, subject, message, cc } = body;
  if (!["contract", "assignment"].includes(kind)) return res.status(400).json({ error: "kind must be 'contract' or 'assignment'" });
  if (!pdfBase64) return res.status(400).json({ error: "pdfBase64 required" });
  if (!Array.isArray(signers) || signers.length < 2) return res.status(400).json({ error: "at least two signers required" });
  for (const sg of signers) {
    if (!sg.name) return res.status(400).json({ error: "every signer needs a name" });
    if (!sg.email && !e164(sg.phone)) return res.status(400).json({ error: `signer ${sg.name} needs an email or a valid US phone` });
  }

  const recipients = signers.map(buildRecipient);
  const ids = recipients.map((r) => r.id);
  const fields = kind === "contract"
    ? contractFields({ sellerId: ids[0], seller2Id: signers.length > 2 ? ids[1] : null, buyerId: ids[ids.length - 1] })
    : assignmentFields({ assigneeId: ids[0], assignorId: ids[1] });

  const payload = {
    test_mode: testMode !== false, // safe default: test mode unless explicitly false
    name: docName || (kind === "contract" ? "Purchase Contract" : "Assignment of Contract"),
    subject: subject || undefined,
    message: message || undefined,
    files: [{ name: fileName || `${kind}.pdf`, file_base64: pdfBase64 }],
    recipients,
    fields: [fields],
    apply_signing_order: true,   // counterparty signs first, you countersign
    reminders: true,
    allow_decline: true,
    embedded_signing: false,
    copied_contacts: Array.isArray(cc) ? cc.filter((c) => c && c.email) : undefined,
  };

  let r = await callSignWell(key, payload);

  // If the workspace isn't SMS-eligible, retry as email-only and hand back the
  // signing links so they can still be texted manually.
  let smsFellBack = false;
  if (!r.ok && JSON.stringify(r.json).toLowerCase().match(/sms|delivery_method|phone/)) {
    const emailOnly = payload.recipients.every((x) => x.email);
    if (emailOnly) {
      payload.recipients = payload.recipients.map(({ phone_number, ...rest }) => ({ ...rest, delivery_method: "email" }));
      r = await callSignWell(key, payload);
      smsFellBack = r.ok;
    }
  }

  if (!r.ok) return res.status(502).json({ error: "SignWell rejected the request", status: r.status, detail: r.json });

  const d = r.json;
  return res.status(200).json({
    id: d.id,
    status: d.status,
    testMode: d.test_mode,
    smsFellBack,
    recipients: (d.recipients || []).map((x) => ({
      name: x.name, email: x.email, status: x.status,
      delivery: x.delivery_method, signingUrl: x.signing_url || null,
    })),
  });
}
