// Install these dependencies in the Vercel project: openai, twilio
const { OpenAI } = require('openai');
const twilio = require('twilio');

// --- Initialization: Uses Environment Variables (Set in Vercel Settings) ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

/**
 * Call OpenAI API to answer a question based on WhatsApp messages.
 * The answer is based ONLY on the provided messages - no external knowledge.
 */
async function callOpenAIQuestionAPI(messages, chatName, question) {
    const context = `You are an assistant that answers questions based ONLY on the provided WhatsApp messages from a group chat.

CRITICAL RULES:
- You MUST answer based ONLY on the information in the provided messages
- Do NOT use any external knowledge or information not present in the messages
- If the answer is not in the messages, clearly state: "I cannot find this information in the messages from ${chatName}"
- Be concise and direct - answer the question directly without unnecessary elaboration
- If multiple people mentioned something, you can reference who said what
- Preserve the language of the question (if asked in Hebrew, answer in Hebrew; if in English, answer in English)

The messages are formatted as: [timestamp] sender: message text

Answer the user's question now based on the messages provided.`;

    // Format messages for the API
    const messageHistory = messages.map(function(msg) {
        const time = msg.time || "";
        const sender = msg.sender || "Unknown";
        const text = msg.text || "";
        
        const contentString = `[${time}] ${sender}: ${text}`;
        return { role: "user", content: contentString };
    });

    // Add the question as the final message
    const questionMessage = {
        role: "user",
        content: `Question about ${chatName}: ${question}`
    };

    const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
            { role: "system", content: context },
            ...messageHistory,
            questionMessage
        ],
        temperature: 0.3, // Lower temperature for more factual, consistent answers
    });

    return completion.choices[0].message.content;
}

async function sendWhatsAppAnswer(recipientPhoneNumber, chatName, question, answer) {
    if (!recipientPhoneNumber) return 'WhatsApp Skipped: No recipient number.';
    try {
        // Remove 'whatsapp:' prefix if present (sender comes as 'whatsapp:+972...')
        const phoneNumber = recipientPhoneNumber.startsWith('whatsapp:') 
            ? recipientPhoneNumber.replace('whatsapp:', '') 
            : recipientPhoneNumber;
        
        const answerMessage = `Question about ${chatName}:\n${question}\n\nAnswer:\n${answer}`;
        const message = await twilioClient.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: `whatsapp:${phoneNumber}`,
            body: answerMessage
        });
        return `WhatsApp sent: ${message.sid}`;
    } catch (e) {
        // Log the error but don't fail the whole function
        console.error('Twilio Error:', e.message);
        return `WhatsApp Delivery Failed: ${e.message}`;
    }
}

// The Main Serverless Function Handler
module.exports = async (req, res) => {
    // Vercel only allows POST for this operation (receiving data from Electron)
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // Get data sent from the Electron client
    const { messages, chatName, question, sender } = req.body;

    if (!messages || messages.length === 0 || !chatName || !question) {
        return res.status(400).json({ 
            error: 'Missing required data (messages, chatName, or question).' 
        });
    }

    try {
        // Generate answer based on messages
        const answer = await callOpenAIQuestionAPI(messages, chatName, question);
        
        // Send answer back via WhatsApp (same as daily brief)
        let whatsappStatus = 'WhatsApp Skipped: No sender.';
        if (sender) {
            console.log(`[Answer-Question API] Sending answer to sender: ${sender}`);
            try {
                whatsappStatus = await sendWhatsAppAnswer(sender, chatName, question, answer);
                console.log(`[Answer-Question API] WhatsApp status: ${whatsappStatus}`);
            } catch (sendError) {
                console.error('[Answer-Question API] Error sending WhatsApp:', sendError);
                whatsappStatus = `WhatsApp Delivery Failed: ${sendError.message}`;
            }
        } else {
            console.warn('[Answer-Question API] No sender provided, cannot send answer via WhatsApp');
        }
        
        // Return the answer and delivery status back to the Electron App (same format as daily brief)
        // ALWAYS include deliveryStatus, even if sending failed
        const response = {
            answer: answer,
            deliveryStatus: { whatsapp: whatsappStatus }
        };
        console.log(`[Answer-Question API] Returning response:`, JSON.stringify(response, null, 2));
        res.status(200).json(response);

    } catch (e) {
        // Catch critical errors (like a failed OpenAI call)
        console.error('Critical Server Error:', e);
        res.status(500).json({ 
            error: 'Failed to process question due to a critical server error.', 
            detail: e.message 
        });
    }
};
