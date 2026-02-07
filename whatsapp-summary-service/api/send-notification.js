// Send a single WhatsApp notification (Twilio or Meta via shared helper)
const { sendWhatsAppResponse } = require("./lib/whatsapp-shared");

module.exports = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method Not Allowed" });
    }

    const { to, message, provider } = req.body;
    if (!to || !message) {
        return res.status(400).json({ error: "Missing required fields: to, message" });
    }

    try {
        const result = await sendWhatsAppResponse(to, message, provider || "twilio");
        const ok = result.startsWith("WhatsApp sent");
        if (ok) {
            return res.status(200).json({ ok: true });
        }
        console.error("[send-notification]", result);
        return res.status(500).json({ error: result || "Failed to send notification" });
    } catch (e) {
        console.error("[send-notification]", e.message);
        return res.status(500).json({ error: e.message || "Failed to send notification" });
    }
};
