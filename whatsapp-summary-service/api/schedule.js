const Pusher = require("pusher");

const pusher = new Pusher({
  appId: process.env.PUSHER_APP_ID,
  key: process.env.PUSHER_KEY,
  secret: process.env.PUSHER_SECRET,
  cluster: process.env.PUSHER_CLUSTER,
  useTLS: true,
});

module.exports = async function handler(req, res) {
  // במקום להגביל לדומיין אחד, נאפשר לכל דומיין זמני של base44 לגשת
  const origin = req.headers.origin;

  if (origin && origin.endsWith('.base44.app')) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    // למקרה שאתה בודק מ-localhost
    res.setHeader('Access-Control-Allow-Origin', '*');
  }

  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { phoneNumber, contactName, date, time, message } = req.body;

  // בדיקת תקינות נתונים
  if (!phoneNumber || !contactName || !date || !time || !message) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    // ניקוי מספר הטלפון ליצירת שם ערוץ תקין
    const cleanPhone = phoneNumber.replace(/\D/g, "");
    const channelName = `channel-${cleanPhone}`;

    // שליחת האירוע ל-Pusher
    await pusher.trigger(channelName, "new-schedule", {
      contactName,
      date,
      time,
      message,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error("Pusher error:", err);
    return res.status(500).json({ error: err.message });
  }
};
