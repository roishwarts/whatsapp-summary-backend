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
    const context = `You are an intelligent assistant that answers questions based on the provided WhatsApp messages from a group chat.

CRITICAL RULES:
- You MUST answer based ONLY on the information in the provided messages
- Do NOT use any external knowledge or information not present in the messages
- UNDERSTAND SEMANTIC MEANING: When the user asks about something, look for related concepts, synonyms, and semantic equivalents in the messages, not just exact word matches
  - Example: If asked "Tell me about the projects", look for discussions about "initiatives", "tasks", "work items", "things we're working on", "plans", "ideas", etc.
  - Example: If asked "What did they say about the meeting?", look for discussions about "get-together", "gathering", "appointment", "scheduled time", etc.
- INTERPRET INTENT: Understand what the user is really asking for, even if they use different terminology than what appears in the messages
- SYNTHESIZE INFORMATION: If the question asks for a summary or overview of a topic, provide a brief synthesis of all relevant information from the messages, even if it's spread across multiple messages
- Be concise and direct - answer the question directly without unnecessary elaboration
- If multiple people mentioned something, you can reference who said what
- Preserve the language of the question (if asked in Hebrew, answer in Hebrew; if in English, answer in English)
- ONLY if you truly cannot find ANY relevant information in the messages (even after semantic interpretation), then state:
  - Hebrew: "לא מצאתי מידע רלוונטי בשיחה. נסה לשאול שאלה ספציפית יותר."
  - English: "I couldn't find relevant information in the conversation. Try asking a more specific question."

The messages are formatted as: [timestamp] sender: message text

Answer the user's question now based on the messages provided, using semantic understanding to find relevant information even if the exact words differ.`;

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
        temperature: 0.5, // Balanced temperature for factual but semantically flexible answers
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
        
        // Send only the answer text, no headers or question
        const message = await twilioClient.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: `whatsapp:${phoneNumber}`,
            body: answer
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

    if (!chatName || !question) {
        return res.status(400).json({ 
            error: 'Missing required data (chatName or question).' 
        });
    }

    // Allow empty messages array - we'll handle it gracefully in the API
    if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ 
            error: 'Invalid messages data.' 
        });
    }

    try {
        // Handle case where there are no messages
        let answer;
        if (!messages || messages.length === 0) {
            // No messages available - return a helpful message
            answer = 'לא מצאתי הודעות בקבוצה זו. נסה לשאול שאלה ספציפית יותר או לבדוק שהשם של הקבוצה נכון.';
            // English fallback
            if (question && /[a-zA-Z]/.test(question)) {
                answer = 'I cannot find any messages in this chat. Please try asking a more specific question or verify the chat name is correct.';
            }
        } else {
            // Generate answer based on messages
            answer = await callOpenAIQuestionAPI(messages, chatName, question);
        }
        
        // Send answer back via WhatsApp (same as daily brief)
        let whatsappStatus = 'WhatsApp Skipped: No sender.';
        if (sender) {
            try {
                whatsappStatus = await sendWhatsAppAnswer(sender, chatName, question, answer);
            } catch (sendError) {
                console.error('[Answer-Question API] Error sending WhatsApp:', sendError);
                whatsappStatus = `WhatsApp Delivery Failed: ${sendError.message}`;
            }
        }
        
        // Return the answer and delivery status back to the Electron App (same format as daily brief)
        res.status(200).json({
            answer: answer,
            deliveryStatus: { whatsapp: whatsappStatus }
        });

    } catch (e) {
        // Catch critical errors (like a failed OpenAI call)
        console.error('Critical Server Error:', e);
        res.status(500).json({ 
            error: 'Failed to process question due to a critical server error.', 
            detail: e.message 
        });
    }
};
