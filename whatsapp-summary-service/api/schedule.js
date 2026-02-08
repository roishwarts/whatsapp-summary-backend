const Pusher = require("pusher");

// אתחול Pusher עם המשתנים מה-Environment
const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

module.exports = async function handler(req, res) {
  // טיפול ב-Preflight request של הדפדפן
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // אימות שמדובר בבקשת POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { phoneNumber, contactName, date, time, message } = req.body;

  // בדיקת תקינות בסיסית
  if (!phoneNumber || !contactName || !date || !time || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // ניקוי מספר הטלפון ליצירת שם ערוץ (רק ספרות)
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    const channelName = `channel-${cleanPhone}`;

    // שליחת האירוע ל-Pusher
    await pusher.trigger(channelName, "new-schedule", {
      contactName,
      date,
      time,
      message,
    });

    console.log(`Event triggered for channel: ${channelName}`);
    return res.status(200).json({ success: true, message: "Event sent to Pusher" });

  } catch (err) {
    console.error("Pusher Error:", err);
    return res.status(500).json({ error: "Internal Server Error", details: err.message });
  }
};
