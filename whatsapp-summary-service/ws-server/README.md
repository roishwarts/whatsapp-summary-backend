# ws-server (Phase 1: test communication)

WebSocket server for the Electron bridge. Stores connections keyed by `device_id` / `phone_number`; accepts `POST /dispatch` to send jobs to Electron.

## Setup

```bash
cd ws-server
npm install
```

## Run

```bash
npm start
```

Listens on `ws://localhost:3001` and `http://localhost:3001` (for `/dispatch`).

## Phase 1 test (round-trip)

1. **Start ws-server:**  
   `npm start` (in this directory).

2. **Start Electron (Whatsapp Agent):**  
   `npm start` in the Whatsapp Agent folder. It connects to `ws://localhost:3001`, registers with `device_id` and `phone_number` (from settings, or `+1234567890` if not set).

3. **Trigger a job:**  
   Use the same `from` as the Electron `phone_number`:

   ```bash
   curl -X POST http://localhost:3001/dispatch \
     -H "Content-Type: application/json" \
     -d '{"from":"+1234567890","body":"hi","intent":"question","group_id":"Sales"}'
   ```

4. **Check:**  
   - Electron receives the job and replies with `result: 'pong'`.  
   - ws-server logs e.g. `[dispatch] Job sent: <jobId> to +1234567890` and `[ws] Response for job <jobId> from +1234567890 -> result: pong`.

**Note:** If you use a different `phone_number` in Electron (e.g. from settings), use that same value for `"from"` in the curl command.
