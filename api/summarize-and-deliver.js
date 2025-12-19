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
    // UPDATED PROMPT: Added language matching instructions
    const context = `You are a helpful assistant. Summarize the following WhatsApp messages from the chat "${chatName}". 
    1. Your response MUST be in the SAME LANGUAGE as the input messages (e.g., if messages are in Hebrew, summarize in Hebrew).
    2. Provide a "Daily brief" that is concise and focused on key decisions and action items.
    3. Use bullet points for clarity.`;
    
    const messageHistory = messages.map(msg => {
        const contentString = typeof msg === 'string' 
            ? msg 
            : '[${msg.time || ''}] ${msg.sender || 'Unknown'}: ${msg.text || ''}';
            
        return { role: 'user', content: contentString };
    });

    const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // UPDATED MODEL
        messages: [{ role: 'system', content: context }, ...messageHistory],
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