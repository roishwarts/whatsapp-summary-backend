/**
 * Shared WhatsApp logic: process incoming commands (Pusher trigger) and send replies (Twilio or Meta).
 * Used by Twilio webhook, Meta webhook, send-notification, answer-question, and summarize-and-deliver.
 */

const Pusher = require("pusher");
const twilio = require("twilio");

const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

const twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

/** Optional hook for DB logging; set to a function to log incoming commands. */
function onCommandReceived(from, text, provider) {
    // No-op by default; can be overridden for DB logging
}

/**
 * Process an incoming WhatsApp command: trigger Pusher so Electron receives it.
 * Payload shape is unchanged so Electron requires zero changes.
 *
 * @param {string} from - Sender identifier (e.g. whatsapp:+972... or Meta numeric ID).
 * @param {string} text - Message body (already resolved; voice is handled by webhook before calling).
 * @param {string} provider - 'twilio' or 'meta'.
 * @param {{ isVoiceMessage?: boolean, isError?: boolean }} options - Optional flags.
 */
async function processWhatsAppCommand(from, text, provider, options = {}) {
    const payload = {
        message: text,
        sender: from,
        time: new Date().toLocaleTimeString(),
        ...(options.isVoiceMessage !== undefined && { isVoiceMessage: options.isVoiceMessage }),
        ...(options.isError !== undefined && { isError: options.isError })
    };
    await pusher.trigger("whatsapp-channel", "new-command", payload);
    if (typeof onCommandReceived === "function") {
        try {
            onCommandReceived(from, text, provider);
        } catch (e) {
            console.error("[whatsapp-shared] onCommandReceived error:", e.message);
        }
    }
}

/**
 * Normalize phone number for sending: strip whatsapp: prefix and return digits (with + for Twilio).
 * Meta expects digits only (no +); Twilio expects whatsapp:+...
 */
function normalizePhoneForSend(to, forMeta = false) {
    let normalized = (to || "").trim().replace(/^whatsapp:/i, "").replace(/\D/g, "");
    if (!forMeta && normalized) {
        normalized = "+" + normalized;
    }
    return normalized;
}

/**
 * Send a WhatsApp reply via Twilio or Meta Cloud API.
 *
 * @param {string} to - Recipient (can include whatsapp: prefix).
 * @param {string} message - Body to send.
 * @param {string} provider - 'twilio' or 'meta'.
 * @returns {Promise<string>} Status string (e.g. "WhatsApp sent: SM..." or "WhatsApp Delivery Failed: ...").
 */
async function sendWhatsAppResponse(to, message, provider) {
    if (!to || !message) {
        return "WhatsApp Skipped: No recipient or message.";
    }

    const providerKey = (provider || process.env.DEFAULT_WHATSAPP_PROVIDER || "twilio").toLowerCase();

    if (providerKey === "twilio") {
        if (!twilioClient || !process.env.TWILIO_WHATSAPP_NUMBER) {
            return "WhatsApp Skipped: Twilio not configured.";
        }
        try {
            const phoneNumber = normalizePhoneForSend(to, false);
            const msg = await twilioClient.messages.create({
                from: process.env.TWILIO_WHATSAPP_NUMBER,
                to: `whatsapp:${phoneNumber}`,
                body: message
            });
            return `WhatsApp sent: ${msg.sid}`;
        } catch (e) {
            console.error("[whatsapp-shared] Twilio send error:", e.message);
            return `WhatsApp Delivery Failed: ${e.message || "Unknown error"}`;
        }
    }

    if (providerKey === "meta") {
        const token = process.env.WHATSAPP_CLOUD_API_TOKEN;
        const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        if (!token || !phoneNumberId) {
            return "WhatsApp Skipped: Meta Cloud API not configured.";
        }
        const toDigits = normalizePhoneForSend(to, true);
        if (!toDigits) {
            return "WhatsApp Skipped: Invalid recipient number.";
        }
        try {
            const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;
            const body = {
                messaging_product: "whatsapp",
                to: toDigits,
                type: "text",
                text: { body: message }
            };
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(body)
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                const errMsg = data.error?.message || data.error?.error_user_msg || response.statusText;
                return `WhatsApp Delivery Failed: ${errMsg}`;
            }
            const msgId = data.messages && data.messages[0] && data.messages[0].id;
            return msgId ? `WhatsApp sent: ${msgId}` : "WhatsApp sent.";
        } catch (e) {
            console.error("[whatsapp-shared] Meta send error:", e.message);
            return `WhatsApp Delivery Failed: ${e.message || "Unknown error"}`;
        }
    }

    return `WhatsApp Skipped: Unknown provider "${provider}".`;
}

module.exports = {
    processWhatsAppCommand,
    sendWhatsAppResponse,
    normalizePhoneForSend,
    onCommandReceived
};
