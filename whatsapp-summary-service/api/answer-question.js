// Install these dependencies in the Vercel project: openai
const { OpenAI } = require('openai');

// --- Initialization: Uses Environment Variables (Set in Vercel Settings) ---
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

// The Main Serverless Function Handler
module.exports = async (req, res) => {
    // Vercel only allows POST for this operation (receiving data from Electron)
    if (req.method !== 'POST') {
        return res.status(405).send('Method Not Allowed');
    }

    // Get data sent from the Electron client
    const { messages, chatName, question } = req.body;

    if (!messages || messages.length === 0 || !chatName || !question) {
        return res.status(400).json({ 
            error: 'Missing required data (messages, chatName, or question).' 
        });
    }

    try {
        // Generate answer based on messages
        const answer = await callOpenAIQuestionAPI(messages, chatName, question);
        
        // Return the answer back to the Electron App
        res.status(200).json({ 
            answer: answer
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
