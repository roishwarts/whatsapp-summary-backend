// Install these dependencies in the Vercel project: openai, twilio, nodemailer
const { OpenAI } = require('openai');
const twilio = require('twilio');
const nodemailer = require('nodemailer');

// --- Initialization: Uses Environment Variables (Set in Vercel Settings) ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_PORT == 465, // Use true for 465, false for 587
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    }
});


// --- Core Logic Functions (Moved from your main.js) ---

async function callOpenAIChatAPI(messages, chatName) {
    const context = "You are an assistant that summarizes WhatsApp chats for busy users."+

"Your goal is NOT to summarize everything."+
"Your goal is to help the user avoid missing important actions, dates, deadlines, or decisions."+

"Generate a short, actionable daily summary based only on what actually exists in the chat."+

"FORMAT RULES:"+
"- First line MUST be:"+
  "<Chat Name> – <Date>"+
"- Second line MUST be a very short TL;DR (max 2 sentences)"+
"- Use bullet points"+
"- Be concise and practical"+
"- Do not invent information"+
"- Do not include greetings, emojis, or filler"+
"- Do not include participant names unless necessary for clarity"+
"- If a section has no relevant content, DO NOT include it at all"+

"STRUCTURE (follow this order, include only sections that apply):"+

"1. ACTION ITEMS"+
"- Clear tasks or follow-ups"+
"- Include owner and/or deadline if explicitly mentioned"+

"2. DATES & DEADLINES"+
"- Dates, times, or deadlines"+
"- Include brief context"+
"- Use ISO date format if possible (YYYY-MM-DD)"+

"3. DECISIONS"+
"- Decisions made, confirmations, approvals, or rejections"+

"4. IMPORTANT UPDATES"+
"- Significant launches, changes, issues, or requests for feedback"+
"- Ignore casual chatter and repetition"+

"5. CONTEXT (VERY SHORT)"+
"- One short sentence describing what this chat was mainly about"+

"Generate the summary now."
;

    const messageHistory = messages.map(function(msg) {
        // We are using double quotes and + to combine strings here
        // No backticks required.
        var time = msg.time || "";
        var sender = msg.sender || "Unknown";
        var text = msg.text || "";
        
        var contentString = (typeof msg === 'string') 
            ? msg 
            : "[" + time + "] " + sender + ": " + text;
            
        return { role: "user", content: contentString };
    });

    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "system", content: context }].concat(messageHistory),
        temperature: 0.5,
    });
    return completion.choices[0].message.content;
}

async function sendWhatsAppMessage(recipientPhoneNumber, summary) {
    if (!recipientPhoneNumber) return 'WhatsApp Skipped: No number.';
    try {
        const message = await twilioClient.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: `whatsapp:${recipientPhoneNumber}`,
            body: `WhatsApp Summarizer: \n\n${summary}`,
        });
        return `WhatsApp sent: ${message.sid}`;
    } catch (e) {
        // Log the error but don't fail the whole function (we still want the summary)
        console.error('Twilio Error:', e.message);
        return `WhatsApp Delivery Failed: ${e.message}`;
    }
}

async function sendEmail(recipientEmail, chatName, summary) {
    if (!recipientEmail || !process.env.SMTP_USER) return 'Email Skipped: No recipient or sender set.';
    try {
        await transporter.sendMail({
            from: process.env.EMAIL_SENDER || process.env.SMTP_USER, 
            to: recipientEmail,
            subject: `New WhatsApp Summary for ${chatName}`,
            text: `Here is the summary for your chat "${chatName}":\n\n${summary}`,
        });
        return 'Email sent successfully.';
    } catch (e) {
        console.error('Nodemailer Error:', e.message);
        return `Email Delivery Failed: ${e.message}`;
    }
}


// The Main Serverless Function Handler
module.exports = async (req, res) => {
    // Vercel only allows POST for this operation (receiving data from Electron)
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // Get data sent from the Electron client
    const { messages, chatName, recipientInfo } = req.body;

    if (!messages || messages.length === 0 || !chatName || !recipientInfo) {
        return res.status(400).json({ error: 'Missing required data (messages, chatName, or recipientInfo).' });
    }

    try {
        // 1. Generate Summary
        const summary = await callOpenAIChatAPI(messages, chatName);
        
        // 2. Deliver Summary 
        const whatsappStatus = await sendWhatsAppMessage(
            recipientInfo.recipientPhoneNumber, 
            summary
        );
        const emailStatus = await sendEmail(
            recipientInfo.recipientEmail, 
            chatName, 
            summary
        );
        
        // 3. Return the final summary and status back to the Electron App
        res.status(200).json({ 
            summary: summary,
            deliveryStatus: { whatsapp: whatsappStatus, email: emailStatus }
        });

    } catch (e) {
        // Catch critical errors (like a failed OpenAI call)
        console.error('Critical Server Error:', e);
        res.status(500).json({ error: 'Failed to process summary due to a critical server error.', detail: e.message });
    }
};