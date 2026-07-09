'use client';

import React, { useState } from 'react';

const SUGGESTED_QUESTIONS = [
  '¿Cuáles son los 5 leads con mayor puntuación comercial y por qué?',
  'Resume el perfil e intereses de los leads interesados en IA y automatización.',
  '¿Qué provincia muestra mayor volumen de leads prioritarios y calientes?',
  'Analiza las razones de descalificación o riesgos comerciales más comunes.',
];

export function AnalystChat() {
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'assistant'; text: string }>>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const askQuestion = async (question: string) => {
    if (!question.trim() || loading) return;
    setLoading(true);
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', text: question }]);

    try {
      const response = await fetch('/api/ai/analyst', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          question,
          conversationHistory: messages.map(m => ({ role: m.role, text: m.text }))
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Error al conectar con el Analista IA');
      }

      setMessages((prev) => [...prev, { role: 'assistant', text: data.answer || 'No se obtuvo respuesta.' }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    askQuestion(input);
    setInput('');
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <div className="chat-header-info">
          <div className="ia-avatar">🤖</div>
          <div>
            <h3>Analista de Inteligencia Comercial</h3>
            <span className="status-indicator">Analista IA en línea</span>
          </div>
        </div>
      </div>

      <div className="chat-history">
        {messages.length === 0 ? (
          <div className="chat-welcome">
            <div className="welcome-icon">🧠</div>
            <h2>Asistente Comercial Inteligente</h2>
            <p className="muted">
              Pregúntame cualquier métrica de leads, scoring, conversiones o rendimiento por canal.
            </p>
            <div className="suggestions-grid">
              {SUGGESTED_QUESTIONS.map((q, idx) => (
                <button
                  key={idx}
                  onClick={() => askQuestion(q)}
                  className="suggestion-btn"
                  disabled={loading}
                >
                  <span className="suggestion-bullet">✦</span> {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, idx) => (
            <div key={idx} className={`chat-bubble-wrapper ${m.role}`}>
              <div className="chat-sender-label">
                {m.role === 'user' ? 'Tú' : 'Analista IA'}
              </div>
              <div className="chat-bubble">
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{m.text}</p>
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="chat-bubble-wrapper assistant loading">
            <div className="chat-sender-label">Analista IA</div>
            <div className="chat-bubble animate-pulse">
              <span className="typing-indicator">Procesando y consultando base de datos en tiempo real...</span>
            </div>
          </div>
        )}
        {error && (
          <div className="error-card">
            <strong>Error del sistema:</strong> {error}
          </div>
        )}
      </div>

      <form onSubmit={handleSubmit} className="chat-input-wrapper">
        <div className="chat-input-container">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Haz una pregunta al analista (ej. Clasificación, Imán más rentable)..."
            className="chat-input"
            disabled={loading}
          />
          <button type="submit" className="chat-submit-btn" disabled={loading || !input.trim()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
      </form>

      <style jsx>{`
        .chat-container {
          display: flex;
          flex-direction: column;
          height: 600px;
          background: rgba(15, 23, 42, 0.35);
          backdrop-filter: blur(16px);
          border: 1px solid var(--line);
          border-radius: 14px;
          overflow: hidden;
          box-shadow: 
            0 10px 40px rgba(0, 0, 0, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.03);
        }

        /* Encabezado del Chat */
        .chat-header {
          padding: 16px 20px;
          border-bottom: 1px solid var(--line);
          background: rgba(9, 9, 11, 0.4);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .chat-header-info {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .ia-avatar {
          width: 32px;
          height: 32px;
          border-radius: 8px;
          background: linear-gradient(135deg, #10b981 0%, #047857 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 16px;
          box-shadow: 0 0 12px var(--accent-glow);
        }

        .chat-header h3 {
          margin: 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--text);
        }

        .status-indicator {
          font-size: 11px;
          color: var(--good);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .status-indicator::before {
          content: "";
          display: inline-block;
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--good);
          animation: blink 2s infinite;
        }

        @keyframes blink {
          0%, 100% { opacity: 0.4; }
          50% { opacity: 1; }
        }

        /* Historial */
        .chat-history {
          flex: 1;
          padding: 24px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        
        .chat-welcome {
          text-align: center;
          margin: auto;
          max-width: 500px;
          padding: 20px 0;
        }

        .welcome-icon {
          font-size: 40px;
          margin-bottom: 16px;
        }

        .chat-welcome h2 {
          font-size: 18px;
          font-weight: 600;
          margin: 0 0 10px;
          color: var(--text);
          letter-spacing: -0.02em;
        }

        .chat-welcome p {
          font-size: 14px;
          line-height: 1.5;
        }
        
        .suggestions-grid {
          display: grid;
          gap: 10px;
          margin-top: 24px;
          text-align: left;
        }
        
        .suggestion-btn {
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--line);
          color: var(--muted);
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 13px;
          text-align: left;
          cursor: pointer;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .suggestion-btn:hover:not(:disabled) {
          background: rgba(255, 255, 255, 0.05);
          border-color: rgba(255, 255, 255, 0.15);
          color: var(--text);
          transform: translateX(4px);
        }

        .suggestion-bullet {
          color: var(--accent);
        }
        
        /* Burbujas de Chat */
        .chat-bubble-wrapper {
          display: flex;
          flex-direction: column;
          max-width: 80%;
          animation: bubbleUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }

        @keyframes bubbleUp {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        
        .chat-bubble-wrapper.user {
          align-self: flex-end;
          align-items: flex-end;
        }
        
        .chat-bubble-wrapper.assistant {
          align-self: flex-start;
          align-items: flex-start;
        }
        
        .chat-sender-label {
          font-size: 11px;
          color: var(--muted);
          margin-bottom: 6px;
          font-weight: 600;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        
        .chat-bubble {
          padding: 14px 18px;
          border-radius: 14px;
          font-size: 14.5px;
          line-height: 1.5;
          box-shadow: 0 4px 15px rgba(0, 0, 0, 0.15);
        }
        
        .user .chat-bubble {
          background: var(--accent);
          color: #ffffff;
          border-bottom-right-radius: 2px;
          box-shadow: 
            0 4px 15px rgba(16, 185, 129, 0.25),
            inset 0 1px 0 rgba(255, 255, 255, 0.1);
        }
        
        .assistant .chat-bubble {
          background: rgba(255, 255, 255, 0.03);
          color: #e4e4e7;
          border-bottom-left-radius: 2px;
          border: 1px solid var(--line);
        }
        
        /* Contenedor del Input (Prompt Integrado) */
        .chat-input-wrapper {
          padding: 18px 24px;
          border-top: 1px solid var(--line);
          background: rgba(9, 9, 11, 0.5);
        }

        .chat-input-container {
          display: flex;
          background: #09090b;
          border: 1px solid var(--line);
          border-radius: 12px;
          padding: 6px;
          gap: 6px;
          transition: all 0.2s ease;
        }

        .chat-input-container:focus-within {
          border-color: var(--accent);
          box-shadow: 0 0 12px rgba(16, 185, 129, 0.2);
        }
        
        .chat-input {
          flex: 1;
          background: transparent;
          border: none;
          color: var(--text);
          padding: 8px 12px;
          outline: none;
          font-size: 14px;
        }
        
        .chat-submit-btn {
          background: var(--accent);
          color: white;
          border: none;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
        }
        
        .chat-submit-btn:hover:not(:disabled) {
          background: #059669;
          transform: scale(1.05);
        }
        
        .chat-submit-btn:disabled {
          background: rgba(255, 255, 255, 0.03);
          color: var(--muted);
          cursor: not-allowed;
        }

        .error-card {
          background: var(--bad-bg);
          border: 1px solid rgba(244, 63, 94, 0.2);
          color: #fca5a5;
          padding: 14px 18px;
          border-radius: 10px;
          font-size: 13.5px;
          display: flex;
          align-items: center;
          gap: 10px;
          animation: shake 0.4s ease;
        }

        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-4px); }
          75% { transform: translateX(4px); }
        }
        
        .typing-indicator {
          color: var(--muted);
          font-weight: 500;
        }
      `}</style>
    </div>
  );
}
