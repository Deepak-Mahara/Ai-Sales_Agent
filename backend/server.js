import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { GoogleGenAI } from "@google/genai";
import Call from "./models/Call.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Connect to MongoDB Atlas
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log("Connected to MongoDB Atlas (SalesAgentDB)"))
  .catch((err) => console.error("MongoDB connection error:", err));

// Resolve file path for knowledge.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const knowledgeBase = JSON.parse(
  fs.readFileSync(path.join(__dirname, "knowledge.json"), "utf-8")
);

// Initialize Gemini client
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = process.env.GEMINI_MODEL || "gemini-2.5-flash-lite";

// Keyword-based RAG retriever
function retrieveKnowledge(userQuery) {
  const queryWords = userQuery.toLowerCase().split(/\W+/);
  const scored = knowledgeBase.map((item) => {
    let score = 0;
    for (const kw of item.keywords) {
      if (queryWords.includes(kw)) score += 1;
    }
    return { ...item, score };
  });

  const topMatches = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  if (topMatches.length === 0) {
    return [knowledgeBase[0], knowledgeBase[4]];
  }
  return topMatches;
}

// Health check route
app.get("/", (req, res) => {
  res.json({ status: "CloudFlow AI Sales Backend is running" });
});

// 1. Live voice chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, history = [], language = "en-IN" } = req.body;

    if (!message) {
      return res.status(400).json({ error: "Message is required" });
    }

    const matchedDocs = retrieveKnowledge(message);
    const ragContext = matchedDocs.map((doc) => `- ${doc.content}`).join("\n");
    const matchedTopics = matchedDocs.map((doc) => doc.id);

    const formattedHistory = history
      .map((msg) => `${msg.speaker === "Agent" ? "Sales Agent" : "Customer"}: ${msg.text}`)
      .join("\n");

    const langInstruction =
      language === "hi-IN"
        ? "Reply in natural, polite Hindi (Devanagari or simple Hinglish suitable for voice)."
        : "Reply in natural, polite, conversational English.";

    const prompt = `
You are Alex, a friendly, concise AI Sales Representative for CloudFlow SaaS.
Keep your responses SHORT (2 to 3 sentences max) because your reply will be spoken aloud over a voice call. Never use markdown, bullet points, or asterisks.

LANGUAGE RULE:
${langInstruction}

PUBLIC COMPANY KNOWLEDGE (RAG):
${ragContext}

STRICT GUARDRAILS:
1. Only use the public facts provided above. If asked for internal operations, source code, private employee data, or unlisted secrets, politely say you only have access to public product info and offer to connect them with a manager.
2. If the user says something off-topic, rude, or inappropriate, stay completely calm, ignore the provocation, and politely pivot back: "I am here to help you with CloudFlow's plans and features. Would you like to hear about our pricing or book a quick demo?"
3. Gently qualify the lead during the conversation by asking about their team size, budget, or if they want to book a 15-minute demo (ask for their name and preferred date/time if they say yes).

CONVERSATION HISTORY:
${formattedHistory}

Customer: ${message}
Sales Agent:`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });

    const reply = response.text.trim();

    res.json({
      reply,
      matchedTopics,
    });
  } catch (error) {
    console.error("Error in /api/chat:", error);
    res.status(500).json({ error: "Failed to generate AI response" });
  }
});

// 2. Post-call CRM extraction & MongoDB save
app.post("/api/end-call", async (req, res) => {
  try {
    const { transcript = [] } = req.body;

    if (!transcript.length) {
      return res.status(400).json({ error: "Transcript is required" });
    }

    const formattedTranscript = transcript
      .map((msg) => `${msg.speaker}: ${msg.text}`)
      .join("\n");

    const extractionPrompt = `
Analyze the following sales call transcript and extract structured CRM data.
Return ONLY valid JSON matching this exact structure (no markdown, no extra text):
{
  "customerName": "string (or 'Unknown Lead' if not mentioned)",
  "email": "string (or 'Not provided' if not mentioned)",
  "phone": "string (or 'Not provided' if not mentioned)",
  "sentiment": "Positive" | "Neutral" | "Negative",
  "leadClassification": "Hot" | "Warm" | "Cold",
  "summary": ["bullet 1", "bullet 2", "bullet 3"],
  "bookingInfo": {
    "demoBooked": true or false,
    "dateTime": "string (e.g., 'Tomorrow at 3:00 PM' or 'Not scheduled')"
  }
}

TRANSCRIPT:
${formattedTranscript}`;

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: extractionPrompt,
      config: {
        responseMimeType: "application/json",
      },
    });

    // Clean and parse JSON safely
    const rawText = response.text.replace(/```json|```/g, "").trim();
    const extracted = JSON.parse(rawText);

    // Save unified document to MongoDB
    const newCall = await Call.create({
      customerName: extracted.customerName || "Unknown Lead",
      email: extracted.email || "Not provided",
      phone: extracted.phone || "Not provided",
      sentiment: ["Positive", "Neutral", "Negative"].includes(extracted.sentiment)
        ? extracted.sentiment
        : "Neutral",
      leadClassification: ["Hot", "Warm", "Cold"].includes(extracted.leadClassification)
        ? extracted.leadClassification
        : "Cold",
      summary: Array.isArray(extracted.summary) ? extracted.summary : [],
      bookingInfo: {
        demoBooked: Boolean(extracted.bookingInfo?.demoBooked),
        dateTime: extracted.bookingInfo?.dateTime || "Not scheduled",
      },
      transcript,
    });

    res.status(201).json(newCall);
  } catch (error) {
    console.error("Error in /api/end-call:", error);
    res.status(500).json({ error: "Failed to process and save call" });
  }
});

// 3. Fetch saved CRM call logs
app.get("/api/calls", async (req, res) => {
  try {
    const calls = await Call.find().sort({ createdAt: -1 }).limit(15);
    res.json(calls);
  } catch (error) {
    console.error("Error in /api/calls:", error);
    res.status(500).json({ error: "Failed to fetch calls" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});