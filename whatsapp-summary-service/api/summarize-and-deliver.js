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

// Date Detection Function
function detectDatesInText(text) {
    const dateRegex = /\b(\d{4}-\d{2}-\d{2})\b/g;
    const dates = [];
    let match;
    
    while ((match = dateRegex.exec(text)) !== null) {
        const dateString = match[1];
        const dateObj = new Date(dateString);
        
        // Validate that it's a valid date and not in a URL
        if (!isNaN(dateObj.getTime()) && 
            (match.index === 0 || text[match.index - 1] !== '/') && 
            (match.index + 10 >= text.length || text[match.index + 10] !== '/')) {
            dates.push({
                dateString: dateString,
                dateObj: dateObj,
                index: match.index,
                length: match[0].length
            });
        }
    }
    
    return dates;
}

// Extract time from context text (e.g., "at 3:00 PM", "15:30", etc.)
function extractTimeFromContext(context, dateString) {
    // Look for time patterns near the date
    const timePatterns = [
        /(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i,  // "3:00 PM" or "03:00 PM"
        /(\d{1,2}):(\d{2})/,                    // "15:30" or "3:30"
        /at\s+(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)/i,  // "at 3:00 PM"
        /at\s+(\d{1,2}):(\d{2})/,              // "at 15:30"
    ];
    
    // Search in context around the date (50 chars before and after)
    const dateIndex = context.indexOf(dateString);
    if (dateIndex === -1) return null;
    
    const searchStart = Math.max(0, dateIndex - 30);
    const searchEnd = Math.min(context.length, dateIndex + dateString.length + 50);
    const searchText = context.substring(searchStart, searchEnd);
    
    for (const pattern of timePatterns) {
        const match = searchText.match(pattern);
        if (match) {
            let hours = parseInt(match[1], 10);
            const minutes = parseInt(match[2], 10);
            const ampm = match[3] ? match[3].toUpperCase() : null;
            
            // Convert to 24-hour format if needed
            if (ampm) {
                if (ampm === 'PM' && hours !== 12) hours += 12;
                if (ampm === 'AM' && hours === 12) hours = 0;
            }
            
            return { hours, minutes };
        }
    }
    
    return null;
}

// Calendar Link Generation Function - generates very short URL
function generateCalendarLink(date, title, description, timeInfo = null) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    let startDate, endDate;
    
    if (timeInfo) {
        // Use specific time
        const startHours = String(timeInfo.hours).padStart(2, '0');
        const startMinutes = String(timeInfo.minutes).padStart(2, '0');
        // Default to 1 hour duration
        let endHours = timeInfo.hours + 1;
        let endMinutes = timeInfo.minutes;
        if (endHours >= 24) {
            endHours = 23;
            endMinutes = 59;
        }
        const endHoursStr = String(endHours).padStart(2, '0');
        const endMinutesStr = String(endMinutes).padStart(2, '0');
        
        startDate = `${year}${month}${day}T${startHours}${startMinutes}00Z`;
        endDate = `${year}${month}${day}T${endHoursStr}${endMinutesStr}00Z`;
    } else {
        // All-day event
        startDate = `${year}${month}${day}`;
        endDate = `${year}${month}${day}`;
    }
    
    // Use shortest possible Google Calendar URL format
    // Minimal parameters: just dates and text (removed details to make it shorter)
    const encodedTitle = encodeURIComponent(title);
    
    // Shortest format: dates and text only (cal.google.com redirects to calendar.google.com)
    const calendarLink = `https://cal.google.com/calendar/render?action=TEMPLATE&dates=${startDate}/${endDate}&text=${encodedTitle}`;
    
    return calendarLink;
}

// Process Summary Text to Add Calendar Links
// Returns both plain text (for WhatsApp) and HTML (for Email) versions
// NOTE: Calendar links are currently disabled - function returns summary unchanged
function addCalendarLinksToSummary(summary, chatName) {
    // Calendar links disabled - return summary unchanged
    return { plainText: summary, html: summary };
}

// Normalize spacing in summary: ensure only one blank line between sections
function normalizeSummarySpacing(summary) {
    // Replace 3 or more consecutive newlines with just 2 newlines (one blank line)
    // This ensures consistent spacing between sections
    return summary.replace(/\n{3,}/g, '\n\n');
}

async function callOpenAIChatAPI(messages, chatName) {
    const context = `You are an assistant that creates a very short daily brief from busy WhatsApp group chats.

The goal is to help the user understand what is IMPORTANT today without reading all messages.
Do NOT summarize everything.
Focus ONLY on actions, relevant dates, decisions, and important updates.

IMPORTANT:
You MUST internally organize the information using ONE of the JSON schemas below
(English or Hebrew) to ensure a consistent structure.
You MUST NOT output JSON.
The final output MUST be plain, human-readable text for the user.

INTERNAL STRUCTURE (FOR REASONING ONLY – DO NOT OUTPUT):

ENGLISH:
{
  "tldr": "string",
  "action_items": [
    { "task": "string", "owner": "string | null" }
  ],
  "dates": [
    { "date": "YYYY-MM-DD", "time": "HH:MM or null", "context": "what the date is for" }
  ],
  "decisions": [
    { "decision": "string" }
  ],
  "important_updates": [
    { "update": "string" }
  ]
}

HEBREW:
{
  "תקציר": "string",
  "משימות": [
    { "משימה": "string", "אחראי": "string | null" }
  ],
  "תאריכים": [
    { "תאריך": "YYYY-MM-DD", "שעה": "HH:MM או null", "הקשר": "מה התאריך מיועד לו" }
  ],
  "החלטות": [
    { "החלטה": "string" }
  ],
  "עדכונים_חשובים": [
    { "עדכון": "string" }
  ]
}

FINAL OUTPUT RULES (MUST FOLLOW EXACTLY):
- Output MUST be plain text only
- Do NOT show JSON, brackets, quotes, or field names
- No greetings, emojis, or filler
- Use "-" for bullet points
- Keep it VERY short and concise
- Preserve the section order
- If a section has NO content, OMIT IT COMPLETELY
- Never write placeholders like "None" or "No updates"

OUTPUT FORMAT (USER SEES THIS):

TL;DR
(max 1–2 short sentences)

ACTION ITEMS
- Task (include owner ONLY if explicitly mentioned)

DATES
- Format: "YYYY-MM-DD, HH:MM – context description"
- Example: "2024-01-23, 18:30 – team meeting"
- If no time mentioned: "YYYY-MM-DD – context description"
- Example: "2024-01-23 – project deadline"
- Always include clear context about what the date is for

DECISIONS
- Decision made

IMPORTANT UPDATES
- Important update

LANGUAGE ENFORCEMENT (MANDATORY):
- First, detect the primary language of the input messages.
- IF the language is Hebrew:
  - Output MUST be entirely in Hebrew.
  - Use ONLY Hebrew section headers.
  - Do NOT use any English words at all (including section titles).
- IF the language is English:
  - Output MUST be entirely in English.
  - Use ONLY English section headers.
- Mixing languages is NOT allowed.
- Outputting English when the input is Hebrew is a critical error.

CONTENT RULES:
- Only include explicit, important information
- Ignore chatter, opinions, jokes, repetitions
- If something is not clearly important, exclude it

Generate the final daily brief now.
`
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

async function sendWhatsAppMessage(recipientPhoneNumber, summary, chatName) {
    if (!recipientPhoneNumber) return 'WhatsApp Skipped: No number.';
    try {
        // Normalize spacing in summary (one blank line between sections)
        const normalizedSummary = normalizeSummarySpacing(summary);
        const message = await twilioClient.messages.create({
            from: process.env.TWILIO_WHATSAPP_NUMBER,
            to: `whatsapp:${recipientPhoneNumber}`,
            body: `${chatName} - ${new Date().toLocaleDateString('he-IL')}
\n${normalizedSummary}`,
        });
        return `WhatsApp sent: ${message.sid}`;
    } catch (e) {
        // Log the error but don't fail the whole function (we still want the summary)
        console.error('Twilio Error:', e.message);
        return `WhatsApp Delivery Failed: ${e.message}`;
    }
}

async function sendEmail(recipientEmail, chatName, summaryHtml) {
    if (!recipientEmail || !process.env.SMTP_USER) return 'Email Skipped: No recipient or sender set.';
    try {
        // Convert HTML summary to plain text for text version
        const summaryText = summaryHtml.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
        
        await transporter.sendMail({
            from: process.env.EMAIL_SENDER || process.env.SMTP_USER, 
            to: recipientEmail,
            subject: `New WhatsApp Summary for ${chatName}`,
            text: `Here is the summary for your chat "${chatName}":\n\n${summaryText}`,
            html: `<div style="font-family: Arial, sans-serif; line-height: 1.6;">Here is the summary for your chat "<strong>${chatName}</strong>":<br><br>${summaryHtml.replace(/\n/g, '<br>')}</div>`,
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
        
        // 2. Process Summary to Add Calendar Links (returns both plain text and HTML)
        const enhancedSummaries = addCalendarLinksToSummary(summary, chatName);
        
        // Normalize spacing in the enhanced summaries
        enhancedSummaries.plainText = normalizeSummarySpacing(enhancedSummaries.plainText);
        enhancedSummaries.html = normalizeSummarySpacing(enhancedSummaries.html);
        
        // 3. Deliver Summary 
        const whatsappStatus = await sendWhatsAppMessage(
            recipientInfo.recipientPhoneNumber, 
            enhancedSummaries.plainText,
			chatName
        );
        const emailStatus = await sendEmail(
            recipientInfo.recipientEmail, 
            chatName, 
            enhancedSummaries.html
        );
        
        // 4. Return the final summary and status back to the Electron App
        res.status(200).json({ 
            summary: enhancedSummaries.plainText,
            deliveryStatus: { whatsapp: whatsappStatus, email: emailStatus }
        });

    } catch (e) {
        // Catch critical errors (like a failed OpenAI call)
        console.error('Critical Server Error:', e);
        res.status(500).json({ error: 'Failed to process summary due to a critical server error.', detail: e.message });
    }
};
