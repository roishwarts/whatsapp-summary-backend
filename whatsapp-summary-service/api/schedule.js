const Pusher = require("pusher");

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

module.exports = async function handler(req, res) {
  const origin = req.headers.origin;

  // אבטחה: מאשר רק דומיינים של Base44 או localhost לבדיקות
  if (origin && (origin.endsWith('.base44.app') || origin.includes('localhost'))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  // טיפול בבקשת ה-Preflight (הבדיקה המקדימה של הדפדפן)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { phoneNumber, contactName, date, time, message } = req.body;

  if (!phoneNumber || !contactName || !date || !time || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    await pusher.trigger(`channel-${cleanPhone}`, "new-schedule", {
      contactName,
      date,
      time,
      message,
    });
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Pusher Error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};
