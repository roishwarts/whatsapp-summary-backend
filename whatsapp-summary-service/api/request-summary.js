const Pusher = require("pusher");

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { phoneNumber, chatName, summaryComponents } = req.body;

  if (!phoneNumber || !chatName) {
    return res.status(400).json({ error: "Missing required fields: phoneNumber, chatName" });
  }

  try {
    const cleanPhone = String(phoneNumber).replace(/\D/g, "");
    if (!cleanPhone) {
      return res.status(400).json({ error: "Invalid phoneNumber" });
    }
    const channelName = `channel-${cleanPhone}`;

    await pusher.trigger(channelName, "request-summary", {
      chatName,
      summaryComponents: summaryComponents || null,
    });

    console.log(`request-summary triggered for channel: ${channelName}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Pusher Error:", err);
    return res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
};
