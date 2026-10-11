# Home Credit LAP Voice Agent

This app contains a browser UI, a Node.js orchestration API, and Retell AI / Bolna tool packages for the Home Credit Loan Against Property (LAP) voice assistant.

## Features

- Generates a voice prompt and provider-specific custom-function package.
- Runs eligibility decisions server-side through `POST /api/turn`:
  - property type checks
  - ownership validation
  - document availability requirement
  - loan cap at ₹75,00,000
  - salaried/self-employed and bank-income rule
  - market value and tenure checks
  - transfer logic for existing loans and EMI reduction requests
  - immediate disqualifications
- Keeps per-call state across turns in the Node process and returns the next action, question, disposition, and response for the voice agent.
- Includes an in-browser prompt builder and eligibility flow simulator.

## Run the app and API

Requires Node.js 18 or later. From this folder:

```bash
node server.js
```

Open http://localhost:8000. Set `PORT` to change the port and `HOST` to change the bind interface. The default bind is loopback. For platform integration, place the service behind a secured HTTPS reverse proxy and set `PUBLIC_BASE_URL` to that public HTTPS origin, then restart the server. Do not expose the development server directly to the public internet.

## Platform setup

1. In the app, choose Retell AI or Bolna and select **Build platform package**.
2. Copy the generated `system_prompt` into the platform agent's prompt/task field.
3. Register the generated custom function `advance_lap_call` and set its URL to the package's `orchestration_endpoint`.
4. Make the API reachable to the platform over HTTPS. Add authentication, request verification, rate limiting, persistent session storage, and monitoring before production.
5. Map `session_id` to the platform's stable call ID. On every user turn, have the model send the exact utterance and extracted structured fields, then speak `agent_message` and follow `action`.
6. Configure a CRM/scheduler separately to consume `specialist_callback`, `qualified_callback`, and `callback_requested` dispositions. The included API records the disposition; it does not itself initiate calls, schedule callbacks, or connect a human.

The Retell package uses a custom-function tool definition. The Bolna package provides a function schema and webhook URL; confirm the exact tool-adapter shape for the specific Bolna agent/runtime version when registering it.

## Orchestration API

`GET /api/health` returns service status. `GET /api/integration?provider=retell` or `provider=bolna` returns the prompt and tool package.

Example tool request:

```json
{
  "session_id": "call-123",
  "customer_utterance": "Yes, this is Riya. It is a residential flat, jointly owned.",
  "context": {
    "company_name": "Home Credit",
    "customer_name": "Riya Sharma",
    "agent_name": "Aisha",
    "agent_gender": "female",
    "language": "English"
  },
  "extracted": {
    "identityConfirmed": true,
    "propertyType": "Residential",
    "ownership": "Joint"
  }
}
```

The server returns a structured `action` such as `ask_question`, `confirm_maximum_amount`, `specialist_callback`, `qualified_callback`, `callback_requested`, or `end_call`, along with the authoritative `agent_message` and captured answers. Occupation and income mode are the combined fifth eligibility check; if one arrives first, the returned prompt asks only for the missing piece. The LLM extracts conversational answers; the server validates types and controls eligibility and progression. Values must be submitted in canonical units: currency fields as rupees and tenure as years.

## Testing

Run the logic tests with:

```bash
node --test
```

The session store is in-memory and is cleared on restart; it is suitable for local evaluation, not production traffic.

## Files

- `index.html` / `style.css` – UI layout and styling
- `script.js` / `orchestration.js` – browser prompt builder, simulator, and integration package UI
- `server.js` – static web server, prompt/package endpoint, and call-state orchestration API
- `test/orchestrator.test.js` – state machine tests
