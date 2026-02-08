// Schedule API: accept POST with schedule details and trigger Pusher event for Electron
const Pusher = require('pusher');

const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { phoneNumber, contactName, date, time, message } = req.body || {};
    const trimmed = {
        phoneNumber: typeof phoneNumber === 'string' ? phoneNumber.trim() : '',
        contactName: typeof contactName === 'string' ? contactName.trim() : '',
        date: typeof date === 'string' ? date.trim() : '',
        time: typeof time === 'string' ? time.trim() : '',
        message: typeof message === 'string' ? message.trim() : ''
    };

    const missing = [];
    if (!trimmed.phoneNumber) missing.push('phoneNumber');
    if (!trimmed.contactName) missing.push('contactName');
    if (!trimmed.date) missing.push('date');
    if (!trimmed.time) missing.push('time');
    if (!trimmed.message) missing.push('message');

    if (missing.length > 0) {
        return res.status(400).json({ error: 'Missing required fields: ' + missing.join(', ') });
    }

    const phoneDigits = trimmed.phoneNumber.replace(/\D/g, '');
    const channelName = 'channel-' + phoneDigits;
    if (channelName === 'channel-') {
        return res.status(400).json({ error: 'Invalid phoneNumber' });
    }

    try {
        await pusher.trigger(channelName, 'new-schedule', {
            contactName: trimmed.contactName,
            date: trimmed.date,
            time: trimmed.time,
            message: trimmed.message
        });
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('[schedule] Pusher trigger error:', err.message);
        return res.status(500).json({ error: err.message || 'Failed to trigger schedule event' });
    }
};
