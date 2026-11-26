# CloudFlow AI Sales Agent

An MVP sales assistant for CloudFlow SaaS. It provides a browser-based voice and text chat, answers product questions using a small keyword-based knowledge base, and saves analyzed sales calls as CRM leads in MongoDB.

## How it works

1. The frontend captures speech with the browser's Web Speech API, or accepts typed messages.
2. It sends each message, recent conversation history, and the selected language to the Express backend.
3. The backend finds relevant entries in `backend/knowledge.json` using keyword matching and includes those facts in a prompt to Gemini.
4. The response and matched knowledge topics return to the frontend. For voice calls, the browser reads the response aloud using speech synthesis.
5. When a call ends, the backend asks Gemini to extract lead details, sentiment, lead score, summary, and demo booking information, then saves the result in MongoDB.
6. The dashboard loads recent saved calls and displays lead details, summaries, and matched topics.

## Requirements

- Node.js 22 and npm
- MongoDB running locally, or a MongoDB connection URI
- A Gemini API key with access to a model that supports `generateContent`
- A browser with Web Speech API support for voice features (Chrome is recommended). Typed chat is also available.

## Configuration

Create `backend/.env` with your own values:

```env
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash-lite
MONGO_URI=mongodb://127.0.0.1:27017/SalesAgentDB
PORT=5000
```

`GEMINI_MODEL` is optional; the backend defaults to `gemini-2.5-flash-lite`. Use a model listed as supporting `generateContent` for your API key. A `503` from Gemini usually indicates temporary model load, while a `404` generally means the model ID is unavailable or unsupported.

The root `.gitignore` excludes `backend/.env` and `backend/node_modules/`. Do not commit API keys or other credentials.

## Run locally

Start MongoDB first. In one terminal, install and start the backend:

```powershell
cd backend
npm install
node server.js
```

In a second terminal, install and start the frontend:

```powershell
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (typically `http://localhost:5173`). The frontend calls the backend at `http://localhost:5000`.

## Backend API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/` | Backend health check |
| `POST` | `/api/chat` | Generate a sales-agent response |
| `POST` | `/api/end-call` | Analyze a transcript and save a lead |
| `GET` | `/api/calls` | Return up to 15 recent saved calls |

Example chat request:

```json
{
  "message": "What plans do you offer?",
  "history": [],
  "language": "en-IN"
}
```

Use `"hi-IN"` for Hindi responses. The `history` field is an array of transcript entries with `speaker` and `text` properties.

## Project layout

```text
backend/
  models/Call.js       Mongoose schema for saved calls and leads
  knowledge.json       Product facts and retrieval keywords
  server.js            Express API, Gemini calls, and MongoDB integration
frontend/
  src/App.jsx          Voice/text interface and CRM dashboard
```
