/**
 * WhatsApp Cloud API (Meta) webhook.
 * GET: verification (hub.mode, hub.verify_token, hub.challenge).
 * POST: parse Meta JSON and forward to processWhatsAppCommand (Pusher).
 */

const { processWhatsAppCommand } = require("../lib/whatsapp-shared");

/** Normalize Meta sender ID to same convention as Twilio (whatsapp:+...) for Electron. */
function normalizeFrom(metaFrom) {
    if (metaFrom == null) return "";
    const s = String(metaFrom).trim();
    return s ? `whatsapp:+${s}` : "";
}

module.exports = async (req, res) => {
    if (req.method === "GET") {
        const mode = req.query["hub.mode"];
        const token = req.query["hub.verify_token"];
        const challenge = req.query["hub.challenge"];
        const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
        if (mode === "subscribe" && verifyToken && token === verifyToken) {
            return res.status(200).send(challenge);
        }
        return res.status(403).send("Forbidden");
    }

    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
    }

    try {
        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
        const entries = body.entry || [];
        for (const entry of entries) {
            const changes = entry.changes || [];
            for (const change of changes) {
                const value = change.value || {};
                const messages = value.messages || [];
                for (const message of messages) {
                    if (message.type === "text" && message.text && message.text.body) {
                        const from = normalizeFrom(message.from);
                        const text = message.text.body;
                        if (from && text) {
                            await processWhatsAppCommand(from, text, "meta");
                        }
                    }
                    // Optional: handle message.type === "audio" later with download + Whisper
                }
            }
        }
        res.status(200).send("ok");
    } catch (error) {
        console.error("[WhatsApp Meta Webhook] Error:", error);
        res.status(500).send("Internal Server Error");
    }
};
