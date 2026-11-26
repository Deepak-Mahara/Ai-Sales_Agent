import { useState, useRef, useEffect } from "react";

const API_BASE = "http://localhost:5000";

export default function App() {
  const [isCallActive, setIsCallActive] = useState(false);
  const [language, setLanguage] = useState("en-IN");
  const [status, setStatus] = useState("Idle");
  const [transcript, setTranscript] = useState([]);
  const [liveSpeech, setLiveSpeech] = useState("");
  const [inputText, setInputText] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSavingCRM, setIsSavingCRM] = useState(false);
  const [matchedTopics, setMatchedTopics] = useState([]);

  // CRM State
  const [currentLead, setCurrentLead] = useState(null);
  const [callLogs, setCallLogs] = useState([]);

  // Refs to avoid stale state inside Web Speech API callbacks
  const recognitionRef = useRef(null);
  const silenceTimerRef = useRef(null);
  const echoTimerRef = useRef(null);
  const spokenBufferRef = useRef("");
  const transcriptRef = useRef([]);
  const isCallActiveRef = useRef(false);
  const isAISpeakingRef = useRef(false);
  const languageRef = useRef("en-IN");
  const transcriptEndRef = useRef(null);

  useEffect(() => {
    transcriptRef.current = transcript;
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript, liveSpeech]);

  useEffect(() => {
    languageRef.current = language;
  }, [language]);

  // Fetch previous calls from MongoDB on page load
  useEffect(() => {
    fetchCallLogs();
    return () => {
      stopVoiceEngine();
    };
  }, []);

  const fetchCallLogs = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/calls`);
      const data = await res.json();
      if (Array.isArray(data)) {
        setCallLogs(data);
        if (data.length > 0 && !currentLead) {
          setCurrentLead(data[0]);
        }
      }
    } catch (err) {
      console.error("Failed to fetch call logs:", err);
    }
  };

  // Immediately kills the microphone so it cannot capture any audio
  const stopListening = () => {
    clearTimeout(silenceTimerRef.current);
    clearTimeout(echoTimerRef.current);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.abort(); // Immediate cutoff (no trailing audio)
      } catch (e) {}
      recognitionRef.current = null;
    }
    spokenBufferRef.current = "";
    setLiveSpeech("");
  };

  const stopVoiceEngine = () => {
    isAISpeakingRef.current = false;
    stopListening();
    window.speechSynthesis.cancel();
  };

  // Text-to-Speech (TTS): Locks mic completely while AI speaks
  const speakText = (text, onDone) => {
    isAISpeakingRef.current = true;
    stopListening(); // Hard-kill mic before AI starts talking
    window.speechSynthesis.cancel();
    setStatus("AI Speaking (Mic Muted)...");

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = languageRef.current;
    utterance.rate = 1.03;

    const finishSpeaking = () => {
      // Wait 350ms so speaker echo dies down before reopening mic
      clearTimeout(echoTimerRef.current);
      echoTimerRef.current = setTimeout(() => {
        isAISpeakingRef.current = false;
        if (isCallActiveRef.current && onDone) {
          onDone();
        }
      }, 350);
    };

    utterance.onend = finishSpeaking;
    utterance.onerror = finishSpeaking;

    window.speechSynthesis.speak(utterance);
  };

  // Speech-to-Text (STT) with 1.5s silence detection
  const startListening = () => {
    if (!isCallActiveRef.current || isAISpeakingRef.current) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setStatus("Use Chrome for Voice (Text works)");
      return;
    }

    stopListening();

    const recognition = new SpeechRecognition();
    recognition.lang = languageRef.current;
    recognition.continuous = true;
    recognition.interimResults = true;
    spokenBufferRef.current = "";

    recognition.onstart = () => {
      if (!isAISpeakingRef.current) {
        setStatus("Listening...");
      }
    };

    recognition.onresult = (event) => {
      // Hard guard: ignore anything if AI is speaking or thinking
      if (isAISpeakingRef.current || !isCallActiveRef.current) return;

      let finalChunk = "";
      let interimChunk = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const text = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalChunk += text + " ";
        } else {
          interimChunk += text;
        }
      }

      if (finalChunk) {
        spokenBufferRef.current += finalChunk;
      }

      const combined = (spokenBufferRef.current + interimChunk).trim();
      setLiveSpeech(combined);

      clearTimeout(silenceTimerRef.current);
      if (combined.length > 0) {
        silenceTimerRef.current = setTimeout(() => {
          const finalMessage = combined;
          stopListening(); // Kill mic immediately while AI thinks & replies
          sendMessageToBackend(finalMessage);
        }, 1500);
      }
    };

    recognition.onerror = (event) => {
      if (event.error === "aborted") return; // Expected when we mute mic
      console.error("Speech recognition error:", event.error);
      if (event.error === "not-allowed") {
        setStatus("Mic Permission Denied");
      }
    };

    recognition.onend = () => {
      // Only auto-restart if call is active AND AI is definitely not speaking
      if (
        isCallActiveRef.current &&
        !isAISpeakingRef.current &&
        !window.speechSynthesis.speaking
      ) {
        try {
          recognition.start();
        } catch (e) {}
      }
    };

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch (e) {
      console.error("Could not start recognition:", e);
    }
  };

  // Start call
  const handleStartCall = () => {
    stopVoiceEngine();

    const greeting =
      language === "hi-IN"
        ? "नमस्ते! मैं CloudFlow से Alex बोल रहा हूँ। आज मैं आपकी क्या मदद कर सकता हूँ?"
        : "Hi! I'm Alex from CloudFlow SaaS. How can I help you today?";

    isCallActiveRef.current = true;
    setIsCallActive(true);
    setTranscript([{ speaker: "Agent", text: greeting }]);
    setMatchedTopics([]);

    speakText(greeting, () => {
      startListening();
    });
  };

  // End call -> Send transcript to /api/end-call -> Save to MongoDB & update CRM
  const handleEndCall = async () => {
    isCallActiveRef.current = false;
    setIsCallActive(false);
    stopVoiceEngine();

    if (transcriptRef.current.length <= 1) {
      setStatus("Call Ended (Too short)");
      return;
    }

    setIsSavingCRM(true);
    setStatus("Analyzing & Saving to CRM...");

    try {
      const response = await fetch(`${API_BASE}/api/end-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: transcriptRef.current }),
      });

      const savedLead = await response.json();

      if (response.ok && savedLead._id) {
        setCurrentLead(savedLead);
        setCallLogs((prev) => [savedLead, ...prev]);
        setStatus("Saved to CRM");
      } else {
        setStatus("CRM Save Failed");
      }
    } catch (err) {
      console.error("End call error:", err);
      setStatus("CRM Save Error");
    } finally {
      setIsSavingCRM(false);
    }
  };

  // Send message to POST /api/chat
  const sendMessageToBackend = async (textToSend) => {
    const trimmed = textToSend.trim();
    if (!trimmed) return;

    isAISpeakingRef.current = true; // Keep mic locked while waiting for API
    stopListening();

    const currentHistory = transcriptRef.current;
    const updatedHistory = [...currentHistory, { speaker: "User", text: trimmed }];
    setTranscript(updatedHistory);
    setInputText("");
    setIsLoading(true);
    setStatus("AI Thinking...");

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: currentHistory,
          language: languageRef.current,
        }),
      });

      const data = await response.json();
      const aiReply =
        data.reply || "Sorry, I had trouble connecting. Please try again.";

      setTranscript((prev) => [...prev, { speaker: "Agent", text: aiReply }]);
      if (data.matchedTopics) {
        setMatchedTopics(data.matchedTopics);
      }

      setIsLoading(false);

      if (isCallActiveRef.current) {
        speakText(aiReply, () => {
          startListening();
        });
      } else {
        isAISpeakingRef.current = false;
      }
    } catch (err) {
      console.error("Chat API error:", err);
      const errMsg = "Server error. Make sure backend is running on port 5000.";
      setTranscript((prev) => [...prev, { speaker: "Agent", text: errMsg }]);
      setIsLoading(false);
      isAISpeakingRef.current = false;
      setStatus("Error");
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (!isCallActive) {
      isCallActiveRef.current = true;
      setIsCallActive(true);
    }
    stopVoiceEngine();
    sendMessageToBackend(inputText);
  };

  const getScoreClass = (score) => {
    if (score === "Hot") return "pill pill-hot";
    if (score === "Warm") return "pill pill-warm";
    return "pill pill-cold";
  };

  const getSentimentClass = (sentiment) => {
    if (sentiment === "Positive") return "pill pill-positive";
    if (sentiment === "Negative") return "pill pill-negative";
    return "pill pill-neutral";
  };

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <h1>CloudFlow AI Voice Sales Agent — MVP Dashboard</h1>
        <span className="badge-live">Voice + RAG + MongoDB Live</span>
      </header>

      {/* Main Split Screen */}
      <div className="split-grid">
        {/* LEFT PANEL: Voice Call Interface */}
        <section className="panel">
          <h2 className="panel-title">Customer Voice Call Interface</h2>

          <div className="call-box">
            <button
              className={`mic-btn ${isCallActive ? "active" : ""}`}
              onClick={handleStartCall}
              title="Start Voice Call"
              disabled={isSavingCRM}
            >
              🎙️
            </button>
            <strong>
              {isCallActive ? "Voice Call Active" : "Click to Start Voice Call"}
            </strong>

            <div className="call-meta">
              <span>
                Status: <strong>{status}</strong>
              </span>
              <label>
                Language:{" "}
                <select
                  className="lang-select"
                  value={language}
                  disabled={isCallActive}
                  onChange={(e) => setLanguage(e.target.value)}
                >
                  <option value="en-IN">English (en-IN)</option>
                  <option value="hi-IN">Hindi (hi-IN)</option>
                </select>
              </label>
            </div>
          </div>

          {/* Live Transcript */}
          <div className="transcript-box">
            {transcript.length === 0 ? (
              <p className="empty-text">
                Click the microphone button above to start speaking...
              </p>
            ) : (
              transcript.map((msg, idx) => (
                <div
                  key={idx}
                  className={`msg-row ${msg.speaker === "User" ? "user" : "agent"}`}
                >
                  <span className="msg-label">{msg.speaker}</span>
                  <div className="msg-bubble">{msg.text}</div>
                </div>
              ))
            )}

            {liveSpeech && (
              <div className="msg-row user" style={{ opacity: 0.7 }}>
                <span className="msg-label">User (speaking...)</span>
                <div className="msg-bubble">{liveSpeech}</div>
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>

          {/* Text Input (Backup for noisy rooms) */}
          <form className="chat-form" onSubmit={handleFormSubmit}>
            <input
              type="text"
              className="chat-input"
              placeholder="Or type a message as backup..."
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={isLoading || isSavingCRM}
            />
            <button
              type="submit"
              className="send-btn"
              disabled={isLoading || isSavingCRM || !inputText.trim()}
            >
              Send
            </button>
          </form>

          <button
            className="end-call-btn"
            onClick={handleEndCall}
            disabled={!isCallActive || isSavingCRM}
          >
            {isSavingCRM
              ? "Analyzing Transcript & Saving to MongoDB..."
              : "End Call & Generate Lead"}
          </button>
        </section>

        {/* RIGHT PANEL: Real-Time CRM & Lead Dashboard */}
        <section className="panel">
          <h2 className="panel-title">Real-Time CRM & Lead Dashboard</h2>

          <div className="crm-grid">
            <div className="crm-card">
              <h3>Current Lead Info</h3>
              <p>Name: <strong>{currentLead?.customerName || "—"}</strong></p>
              <p>Email: {currentLead?.email || "—"}</p>
              <p>Phone: {currentLead?.phone || "—"}</p>
            </div>

            <div className="crm-card">
              <h3>Sentiment & Score</h3>
              <p>
                Sentiment:{" "}
                {currentLead ? (
                  <span className={getSentimentClass(currentLead.sentiment)}>
                    {currentLead.sentiment}
                  </span>
                ) : (
                  "—"
                )}
              </p>
              <p>
                Lead Score:{" "}
                {currentLead ? (
                  <span className={getScoreClass(currentLead.leadClassification)}>
                    {currentLead.leadClassification}
                  </span>
                ) : (
                  "—"
                )}
              </p>
            </div>

            <div className="crm-card highlight">
              <h3>RAG Knowledge Retrieval (Live)</h3>
              {matchedTopics.length > 0 ? (
                <div className="rag-tags">
                  {matchedTopics.map((topic, i) => (
                    <span key={i} className="rag-tag">
                      {topic}
                    </span>
                  ))}
                </div>
              ) : (
                <p>Waiting for customer query...</p>
              )}
            </div>

            <div className="crm-card">
              <h3>Appointment Booking</h3>
              <p>
                Status:{" "}
                <strong>
                  {currentLead?.bookingInfo?.demoBooked
                    ? "Demo Booked"
                    : "Not Booked"}
                </strong>
              </p>
              <p>Slot: {currentLead?.bookingInfo?.dateTime || "—"}</p>
            </div>

            <div className="crm-card" style={{ gridColumn: "1 / -1" }}>
              <h3>Call Summary (AI Generated)</h3>
              {currentLead?.summary?.length > 0 ? (
                <ul className="summary-list">
                  {currentLead.summary.map((bullet, idx) => (
                    <li key={idx}>{bullet}</li>
                  ))}
                </ul>
              ) : (
                <p>End a call to generate the AI summary and save to MongoDB.</p>
              )}
            </div>
          </div>

          <div className="logs-card">
            <h3>Previous Call Logs (Click a row to inspect)</h3>
            {callLogs.length === 0 ? (
              <p className="empty-text">No saved calls yet.</p>
            ) : (
              <table className="logs-table">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Date</th>
                    <th>Score</th>
                    <th>Demo</th>
                  </tr>
                </thead>
                <tbody>
                  {callLogs.map((log) => (
                    <tr key={log._id} onClick={() => setCurrentLead(log)}>
                      <td>{log.customerName}</td>
                      <td>
                        {new Date(log.createdAt).toLocaleString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td>
                        <span className={getScoreClass(log.leadClassification)}>
                          {log.leadClassification}
                        </span>
                      </td>
                      <td>{log.bookingInfo?.demoBooked ? "Booked" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}