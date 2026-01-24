// Twilio → Pusher bridge webhook
// Receives incoming WhatsApp messages from Twilio and immediately forwards them to Pusher

const Pusher = require("pusher");

// Initialize Pusher (values come from Env Variables on Vercel)
const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

module.exports = async (req, res) => {
    // Twilio sends POST requests
    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
    }

    try {
        const incomingMsg = req.body.Body; // WhatsApp message text
        const from = req.body.From;        // Sender (your number)

        console.log(`[Twilio Webhook] Message received: ${incomingMsg}`);

        // Send to Pusher – event the Electron app will listen to
        await pusher.trigger("whatsapp-channel", "new-command", {
            message: incomingMsg,
            sender: from,
            time: new Date().toLocaleTimeString()
        });

        // Return empty TwiML so Twilio is satisfied
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send("<Response></Response>");
    } catch (error) {
        console.error("Error in Twilio Webhook:", error);
        return res.status(500).send("Internal Server Error");
    }
};
