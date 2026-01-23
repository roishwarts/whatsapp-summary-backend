// Twilio Webhook Endpoint
// Handles incoming WhatsApp messages from Twilio
module.exports = async (req, res) => {
    // Only accept POST requests
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // 1. Parse POST: extract From (WhatsApp number) and Body (message text)
        const from = req.body.From || req.body.from;
        const body = String(req.body.Body ?? req.body.body ?? '').trim();

        // 2. Intent: "summary" if body contains "summary" (case-insensitive), otherwise "question"
        const intent = /summary/i.test(body) ? 'summary' : 'question';

        // 3. Extract target group via "for <group>" or "עם <group>"; save as group_id
        let group_id = null;
        const forMatch = body.match(/\bfor\s+([^\s]+)/i);
        const imMatch = body.match(/עם\s+([^\s]+)/);
        if (forMatch) group_id = forMatch[1].trim();
        else if (imMatch) group_id = imMatch[1].trim();

        console.log('=== Twilio Webhook Received ===');
        console.log('From:', from);
        console.log('Body:', body);
        console.log('Intent:', intent);
        console.log('group_id:', group_id);
        console.log('==============================');

        // 4. Return 200 "ok" after processing
        return res.status(200).send('ok');
    } catch (error) {
        console.error('Error processing Twilio webhook:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
};
