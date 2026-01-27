// Twilio → Pusher bridge webhook
// Receives incoming WhatsApp messages from Twilio and immediately forwards them to Pusher
// Supports both text messages and voice recordings (transcribed using OpenAI Whisper)

const Pusher = require("pusher");
const axios = require("axios");
const { OpenAI } = require("openai");

// Initialize Pusher (values come from Env Variables on Vercel)
const pusher = new Pusher({
    appId: process.env.PUSHER_APP_ID,
    key: process.env.PUSHER_KEY,
    secret: process.env.PUSHER_SECRET,
    cluster: process.env.PUSHER_CLUSTER,
    useTLS: true
});

// Initialize OpenAI for transcription
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Download audio file from Twilio media URL
 */
async function downloadAudio(mediaUrl) {
    try {
        // Twilio media URLs require authentication
        const response = await axios.get(mediaUrl, {
            auth: {
                username: process.env.TWILIO_ACCOUNT_SID,
                password: process.env.TWILIO_AUTH_TOKEN
            },
            responseType: 'arraybuffer',
            timeout: 30000 // 30 second timeout
        });
        return Buffer.from(response.data);
    } catch (error) {
        console.error('[Twilio] Error downloading audio:', error.message);
        throw error;
    }
}

/**
 * Transcribe audio using OpenAI Whisper
 */
async function transcribeAudio(audioBuffer) {
    try {
        // Create a File object from the buffer for OpenAI API
        // Vercel uses Node.js 18+ which has the File API available globally
        const audioFile = new File([audioBuffer], 'audio.ogg', { 
            type: 'audio/ogg' 
        });
        
        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model: 'whisper-1',
            // language: 'he', // Optional: specify language (he for Hebrew, en for English)
            // Auto-detects language if not specified
        });
        
        return transcription.text;
    } catch (error) {
        console.error('[OpenAI] Error transcribing audio:', error.message);
        throw error;
    }
}

module.exports = async (req, res) => {
    // Twilio sends POST requests
    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
    }

    try {
        const from = req.body.From;
        let messageText = null;
        let isVoiceMessage = false;
        
        // Check if it's a text message
        if (req.body.Body) {
            messageText = req.body.Body;
            console.log(`[Twilio Webhook] Text message received: ${messageText}`);
        }
        // Check if it's a voice message (media message)
        else if (req.body.NumMedia && parseInt(req.body.NumMedia) > 0) {
            const mediaUrl = req.body.MediaUrl0; // First media URL
            const mediaContentType = req.body.MediaContentType0;
            
            // Check if it's audio
            if (mediaContentType && mediaContentType.startsWith('audio/')) {
                console.log(`[Twilio Webhook] Voice message received from ${from}`);
                isVoiceMessage = true;
                
                try {
                    // Download the audio file
                    console.log(`[Twilio Webhook] Downloading audio from: ${mediaUrl}`);
                    const audioBuffer = await downloadAudio(mediaUrl);
                    console.log(`[Twilio Webhook] Audio downloaded, size: ${audioBuffer.length} bytes`);
                    
                    // Transcribe using OpenAI Whisper
                    console.log(`[Twilio Webhook] Transcribing audio...`);
                    messageText = await transcribeAudio(audioBuffer);
                    
                    console.log(`[Twilio Webhook] Transcribed text: ${messageText}`);
                } catch (error) {
                    console.error('[Twilio Webhook] Error processing voice message:', error);
                    
                    // Send error notification back to user via Pusher
                    const errorMessage = /[\u0590-\u05FF]/.test(from) 
                        ? "שגיאה בעיבוד ההודעה הקולית. נסה שוב או שלח הודעה טקסטואלית."
                        : "Error processing voice message. Please try again or send a text message.";
                    
                    await pusher.trigger("whatsapp-channel", "new-command", {
                        message: errorMessage,
                        sender: from,
                        time: new Date().toLocaleTimeString(),
                        isError: true
                    });
                    
                    res.setHeader("Content-Type", "text/xml");
                    return res.status(200).send("<Response></Response>");
                }
            } else {
                console.log(`[Twilio Webhook] Non-audio media received (${mediaContentType}), ignoring`);
                res.setHeader("Content-Type", "text/xml");
                return res.status(200).send("<Response></Response>");
            }
        } else {
            // No body and no media - empty message
            console.log(`[Twilio Webhook] Empty message received, ignoring`);
            res.setHeader("Content-Type", "text/xml");
            return res.status(200).send("<Response></Response>");
        }
        
        // If we have text (either from text message or transcribed), process it
        if (messageText) {
            // Send to Pusher – event the Electron app will listen to
            await pusher.trigger("whatsapp-channel", "new-command", {
                message: messageText,
                sender: from,
                time: new Date().toLocaleTimeString(),
                isVoiceMessage: isVoiceMessage // Flag to indicate it was from voice
            });
        }

        // Return empty TwiML so Twilio is satisfied
        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send("<Response></Response>");
    } catch (error) {
        console.error("Error in Twilio Webhook:", error);
        return res.status(500).send("Internal Server Error");
    }
};
