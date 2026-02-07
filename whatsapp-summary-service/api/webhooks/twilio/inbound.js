// Twilio → Pusher bridge webhook
// Receives incoming WhatsApp messages from Twilio and forwards them via shared processWhatsAppCommand (Pusher)
// Supports both text messages and voice recordings (transcribed using OpenAI Whisper)

const axios = require("axios");
const { OpenAI } = require("openai");
const { processWhatsAppCommand } = require("../../lib/whatsapp-shared");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Download audio file from Twilio media URL
 */
async function downloadAudio(mediaUrl) {
    try {
        const response = await axios.get(mediaUrl, {
            auth: {
                username: process.env.TWILIO_ACCOUNT_SID,
                password: process.env.TWILIO_AUTH_TOKEN
            },
            responseType: "arraybuffer",
            timeout: 30000
        });
        return Buffer.from(response.data);
    } catch (error) {
        console.error("[Twilio] Error downloading audio:", error.message);
        throw error;
    }
}

/**
 * Transcribe audio using OpenAI Whisper
 */
async function transcribeAudio(audioBuffer) {
    try {
        const audioFile = new File([audioBuffer], "audio.ogg", { type: "audio/ogg" });
        const transcription = await openai.audio.transcriptions.create({
            file: audioFile,
            model: "whisper-1"
        });
        return transcription.text;
    } catch (error) {
        console.error("[OpenAI] Error transcribing audio:", error.message);
        throw error;
    }
}

module.exports = async (req, res) => {
    if (req.method !== "POST") {
        return res.status(405).send("Method Not Allowed");
    }

    try {
        const from = req.body.From;
        let messageText = null;
        let isVoiceMessage = false;

        if (req.body.Body) {
            messageText = req.body.Body;
            console.log(`[Twilio Webhook] Text message received: ${messageText}`);
        } else if (req.body.NumMedia && parseInt(req.body.NumMedia) > 0) {
            const mediaUrl = req.body.MediaUrl0;
            const mediaContentType = req.body.MediaContentType0;

            if (mediaContentType && mediaContentType.startsWith("audio/")) {
                console.log(`[Twilio Webhook] Voice message received from ${from}`);
                isVoiceMessage = true;
                try {
                    const audioBuffer = await downloadAudio(mediaUrl);
                    messageText = await transcribeAudio(audioBuffer);
                    console.log(`[Twilio Webhook] Transcribed text: ${messageText}`);
                } catch (error) {
                    console.error("[Twilio Webhook] Error processing voice message:", error);
                    const errorMessage = /[\u0590-\u05FF]/.test(from)
                        ? "שגיאה בעיבוד ההודעה הקולית. נסה שוב או שלח הודעה טקסטואלית."
                        : "Error processing voice message. Please try again or send a text message.";
                    await processWhatsAppCommand(from, errorMessage, "twilio", { isError: true });
                    res.setHeader("Content-Type", "text/xml");
                    return res.status(200).send("<Response></Response>");
                }
            } else {
                console.log(`[Twilio Webhook] Non-audio media received (${mediaContentType}), ignoring`);
                res.setHeader("Content-Type", "text/xml");
                return res.status(200).send("<Response></Response>");
            }
        } else {
            console.log("[Twilio Webhook] Empty message received, ignoring");
            res.setHeader("Content-Type", "text/xml");
            return res.status(200).send("<Response></Response>");
        }

        if (messageText) {
            await processWhatsAppCommand(from, messageText, "twilio", { isVoiceMessage });
        }

        res.setHeader("Content-Type", "text/xml");
        return res.status(200).send("<Response></Response>");
    } catch (error) {
        console.error("Error in Twilio Webhook:", error);
        return res.status(500).send("Internal Server Error");
    }
};
