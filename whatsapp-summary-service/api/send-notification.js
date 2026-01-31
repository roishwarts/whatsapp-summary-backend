// Send a single WhatsApp notification via Twilio (used for confirmations, success, missed, list/edit/delete replies)
const twilio = require('twilio');

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { to, message } = req.body;

    if (!to || !message) {
        return res.status(400).json({ error: 'Missing required fields: to, message' });
    }

    try {
        const phoneNumber = to.startsWith('whatsapp:') ? to.replace('whatsapp:', '') : to;
        await twilioClient.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: `whatsapp:${phoneNumber}`,
            body: message
        });
        return res.status(200).json({ ok: true });
    } catch (e) {
        console.error('[send-notification] Twilio error:', e.message);
        return res.status(500).json({ error: e.message || 'Failed to send notification' });
    }
};
