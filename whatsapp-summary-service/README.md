# WhatsApp Summary Service (Vercel)

Serverless API for receiving WhatsApp messages (Twilio or Meta Cloud API), triggering Pusher events for the Electron app, and sending replies (summaries, Q&A, notifications).

## Webhooks

- **Twilio (inbound):** `POST /api/webhooks/twilio/inbound`  
  Receives Twilio webhook (From, Body, or voice media). Forwards to Pusher via shared `processWhatsAppCommand`. Supports voice via OpenAI Whisper.

- **Meta Cloud API:** `GET|POST /api/webhooks/whatsapp-meta`  
  - **GET:** Webhook verification. Meta sends `hub.mode`, `hub.verify_token`, `hub.challenge`. Set `WHATSAPP_VERIFY_TOKEN` in Vercel and the same value as “Verify token” in Meta App Dashboard (WhatsApp > Configuration > Webhook).  
  - **POST:** Incoming messages. Parses `entry[].changes[].value.messages[]` (text only in this version) and calls `processWhatsAppCommand(..., 'meta')`.  
  Register the callback URL in Meta: `https://<your-vercel-domain>/api/webhooks/whatsapp-meta`.

Both webhooks produce the same Pusher payload (`whatsapp-channel`, event `new-command`) so the Electron app needs no changes.

## Environment variables

See [.env.example](.env.example) for the full list. Required for your chosen provider:

| Variable | Purpose |
|----------|---------|
| **Pusher** | `PUSHER_APP_ID`, `PUSHER_KEY`, `PUSHER_SECRET`, `PUSHER_CLUSTER` |
| **Twilio** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER` |
| **Meta (optional)** | `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_CLOUD_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` |
| **Optional** | `DEFAULT_WHATSAPP_PROVIDER` — `twilio` or `meta` for outbound (default `twilio`) |

## API routes

- `POST /api/send-notification` — Body: `{ to, message [, provider] }`. Sends a single WhatsApp message via Twilio or Meta.
- `POST /api/answer-question` — Q&A over chat messages; sends answer via WhatsApp using `DEFAULT_WHATSAPP_PROVIDER`.
- `POST /api/summarize-and-deliver` — Summarizes chat and delivers via WhatsApp (and email) using `DEFAULT_WHATSAPP_PROVIDER`.
