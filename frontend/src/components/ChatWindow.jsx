import React, { useState, useRef, useEffect, useCallback } from 'react';
import MessageBubble from './MessageBubble';

const EXAMPLES = [
  "Calculate Zone 1, 2, 3 reach for 132kV line — Zline = 3.2∠80° Ω, CTR=600/1, PTR=132000/110",
  "Write a CAPE VBA macro to loop all buses and export fault levels to Excel",
  "Calculate SLG fault current: 132kV, Z1=3.2∠80°Ω, Z2=3.2∠80°Ω, Z0=9.6∠70°Ω",
  "Explain IDMT overcurrent relay coordination with TMS calculation",
  "What is NERC PRC-023 relay loadability requirement?",
  "Explain 87T transformer differential protection — Slope 1 and Slope 2 settings",
];

export default function ChatWindow({ apiUrl, ragReady }) {
  const [messages,  setMessages]  = useState([]);
  const [input,     setInput]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [useRag,    setUseRag]    = useState(true);
  const bottomRef   = useRef(null);
  const textareaRef = useRef(null);
  const abortRef    = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const resizeTextarea = () => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
  };

  const send = useCallback(async (override) => {
    const text = (override || input).trim();
    if (!text || loading) return;

    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';

    const userMsg  = { role: 'user',      content: text, id: Date.now() };
    const aiBubble = { role: 'assistant', content: '',   id: Date.now() + 1, streaming: true };

    setMessages(prev => [...prev, userMsg, aiBubble]);
    setLoading(true);

    const history = messages.map(m => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: text });

    abortRef.current = new AbortController();

    try {
      const resp = await fetch(`${apiUrl}/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messages: history, stream: true, use_rag: useRag }),
        signal:  abortRef.current.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${resp.status}`);
      }

      const reader  = resp.body.getReader();
      const decoder = new TextDecoder();
      let fullText  = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        fullText += decoder.decode(value, { stream: true });
        setMessages(prev =>
          prev.map(m => m.id === aiBubble.id ? { ...m, content: fullText, streaming: true } : m)
        );
      }

      setMessages(prev =>
        prev.map(m => m.id === aiBubble.id ? { ...m, content: fullText, streaming: false } : m)
      );

    } catch (err) {
      if (err.name === 'AbortError') {
        setMessages(prev =>
          prev.map(m => m.id === aiBubble.id ? { ...m, streaming: false } : m)
        );
      } else {
        let msg = err.message;
        if (msg.includes('fetch') || msg.includes('Failed')) {
          msg = 'Cannot connect to backend. Make sure uvicorn is running on port 8000.';
        }
        setMessages(prev =>
          prev.map(m => m.id === aiBubble.id ? { ...m, content: msg, streaming: false, error: true } : m)
        );
      }
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, apiUrl, useRag]);

  const stop  = () => { abortRef.current?.abort(); setLoading(false); };
  const clear = () => { if (loading) stop(); setMessages([]); };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const isEmpty = messages.length === 0;

  return (
    <div style={s.wrap}>
      {/* Top bar */}
      <div style={s.topBar}>
        <div style={s.topBarLeft}>
          <span style={s.topTitle}>Relay Protection AI</span>
          {ragReady && (
            <span style={s.ragChip}>
              <span style={s.ragDot} />
              RAG · {/* docCount */} docs active
            </span>
          )}
        </div>
        <div style={s.topBarRight}>
          {messages.length > 0 && (
            <button style={s.clearBtn} onClick={clear}>Clear</button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={s.messages}>
        {isEmpty ? (
          <div style={s.welcome}>
            <div style={s.welcomeIcon}>⚡</div>
            <h1 style={s.welcomeTitle}>Relay Protection AI</h1>
            <p style={s.welcomeSub}>
              Expert assistant for distance relay settings, fault analysis, CAPE macros, and NERC standards.
            </p>
            <div style={s.exGrid}>
              {EXAMPLES.map((ex, i) => (
                <button key={i} style={s.exCard} onClick={() => send(ex)}>
                  <span style={s.exText}>{ex}</span>
                  <span style={s.exArrow}>↗</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map(msg => <MessageBubble key={msg.id} message={msg} />)
        )}

        {loading && (
          <div style={s.thinkingRow}>
            <div style={s.aiAvatar}>⚡</div>
            <div style={s.thinking}>
              <span style={{ ...s.thinkDot, animationDelay: '0ms' }} />
              <span style={{ ...s.thinkDot, animationDelay: '160ms' }} />
              <span style={{ ...s.thinkDot, animationDelay: '320ms' }} />
            </div>
          </div>
        )}

        <div ref={bottomRef} style={{ height: 1 }} />
      </div>

      {/* Input */}
      <div style={s.inputZone}>
        <div style={s.inputBox}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); resizeTextarea(); }}
            onKeyDown={handleKey}
            placeholder="Ask about relay settings, fault calculations, CAPE macros…"
            rows={1}
            style={s.textarea}
          />
          <div style={s.inputActions}>
            {/* RAG toggle */}
            {ragReady && (
              <button
                style={{
                  ...s.ragToggle,
                  background: useRag ? '#22c55e18' : 'transparent',
                  color:      useRag ? '#22c55e' : '#555',
                  border:     `1px solid ${useRag ? '#22c55e44' : '#2a2a2a'}`,
                }}
                onClick={() => setUseRag(v => !v)}
                title="Toggle RAG document search"
              >
                RAG {useRag ? 'on' : 'off'}
              </button>
            )}

            {loading ? (
              <button style={s.stopBtn} onClick={stop} title="Stop">
                <StopIcon />
              </button>
            ) : (
              <button
                style={{
                  ...s.sendBtn,
                  background: input.trim() ? '#16a34a' : '#1a1a1a',
                  cursor:     input.trim() ? 'pointer' : 'default',
                }}
                onClick={() => send()}
                disabled={!input.trim()}
                title="Send (Enter)"
              >
                <SendIcon active={!!input.trim()} />
              </button>
            )}
          </div>
        </div>
        <p style={s.hint}>Shift+Enter for new line · responses may contain errors — verify critical calculations</p>
      </div>
    </div>
  );
}

function SendIcon({ active }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke={active ? '#fff' : '#444'} strokeWidth="2.2"
      strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="#ef4444">
      <rect x="3" y="3" width="18" height="18" rx="3"/>
    </svg>
  );
}

const s = {
  wrap: {
    flex:          1,
    display:       'flex',
    flexDirection: 'column',
    overflow:      'hidden',
    background:    '#0f0f0f',
  },
  topBar: {
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'space-between',
    padding:         '12px 20px',
    borderBottom:    '1px solid #1f1f1f',
    flexShrink:      0,
  },
  topBarLeft:  { display: 'flex', alignItems: 'center', gap: 10 },
  topBarRight: { display: 'flex', alignItems: 'center', gap: 8 },
  topTitle: { fontSize: 14, fontWeight: 600, color: '#ddd' },
  ragChip: {
    display:      'flex',
    alignItems:   'center',
    gap:          5,
    background:   '#22c55e12',
    border:       '1px solid #22c55e30',
    borderRadius: 20,
    padding:      '2px 9px',
    fontSize:     11,
    color:        '#22c55e',
    fontWeight:   500,
  },
  ragDot: {
    width:        6,
    height:       6,
    borderRadius: '50%',
    background:   '#22c55e',
  },
  clearBtn: {
    background:   'transparent',
    border:       '1px solid #242424',
    color:        '#555',
    borderRadius: 6,
    padding:      '4px 12px',
    fontSize:     12,
    cursor:       'pointer',
    transition:   'all 0.15s',
  },
  messages: {
    flex:           1,
    overflowY:      'auto',
    padding:        '24px 20px',
    display:        'flex',
    flexDirection:  'column',
    gap:            0,
  },
  welcome: {
    flex:       1,
    display:    'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign:  'center',
    padding:    '40px 20px',
    maxWidth:   700,
    margin:     '0 auto',
    width:      '100%',
    animation:  'fadeUp 0.4s ease',
  },
  welcomeIcon:  { fontSize: 40, marginBottom: 16 },
  welcomeTitle: { fontSize: 26, fontWeight: 700, color: '#fff', marginBottom: 8 },
  welcomeSub:   { fontSize: 15, color: '#666', lineHeight: 1.6, marginBottom: 32, maxWidth: 480 },
  exGrid: {
    display:             'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
    gap:                 8,
    width:               '100%',
  },
  exCard: {
    display:         'flex',
    alignItems:      'flex-start',
    justifyContent:  'space-between',
    gap:             8,
    background:      '#141414',
    border:          '1px solid #1f1f1f',
    borderRadius:    10,
    padding:         '12px 14px',
    cursor:          'pointer',
    textAlign:       'left',
    transition:      'all 0.15s',
    color:           '#888',
    fontSize:        12.5,
    lineHeight:      1.5,
  },
  exText:  { flex: 1 },
  exArrow: { color: '#333', fontSize: 14, flexShrink: 0, marginTop: 1 },
  thinkingRow: {
    display:   'flex',
    alignItems: 'flex-start',
    gap:        12,
    padding:   '8px 0',
    maxWidth:  780,
    width:     '100%',
    margin:    '0 auto',
    animation: 'fadeUp 0.3s ease',
  },
  aiAvatar: {
    width:           32,
    height:          32,
    borderRadius:    8,
    background:      'linear-gradient(135deg, #16a34a, #15803d)',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    fontSize:        14,
    flexShrink:      0,
  },
  thinking: {
    display:    'flex',
    alignItems: 'center',
    gap:        5,
    padding:    '10px 14px',
    background: '#141414',
    border:     '1px solid #1f1f1f',
    borderRadius: '4px 12px 12px 12px',
  },
  thinkDot: {
    display:         'inline-block',
    width:           7,
    height:          7,
    borderRadius:    '50%',
    background:      '#444',
    animation:       'pulse 1.2s ease-in-out infinite',
  },
  inputZone: {
    padding:     '12px 20px 16px',
    borderTop:   '1px solid #1f1f1f',
    flexShrink:  0,
    background:  '#0f0f0f',
  },
  inputBox: {
    display:      'flex',
    flexDirection: 'column',
    background:   '#141414',
    border:       '1px solid #242424',
    borderRadius: 12,
    padding:      '10px 12px 8px',
    maxWidth:     780,
    margin:       '0 auto',
    transition:   'border-color 0.15s',
  },
  textarea: {
    background:  'transparent',
    border:      'none',
    outline:     'none',
    color:       '#ececec',
    fontSize:    14,
    lineHeight:  1.6,
    resize:      'none',
    maxHeight:   160,
    overflowY:   'auto',
    width:       '100%',
    padding:     '0 0 4px',
  },
  inputActions: {
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'flex-end',
    gap:             6,
    marginTop:       4,
  },
  ragToggle: {
    borderRadius: 6,
    padding:      '3px 9px',
    fontSize:     11,
    fontWeight:   500,
    cursor:       'pointer',
    transition:   'all 0.15s',
  },
  sendBtn: {
    width:           32,
    height:          32,
    borderRadius:    8,
    border:          'none',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    transition:      'all 0.15s',
    flexShrink:      0,
  },
  stopBtn: {
    width:           32,
    height:          32,
    borderRadius:    8,
    background:      '#1f1f1f',
    border:          '1px solid #2a2a2a',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    cursor:          'pointer',
    flexShrink:      0,
    transition:      'all 0.15s',
  },
  hint: {
    textAlign:  'center',
    color:      '#333',
    fontSize:   11,
    marginTop:  8,
    maxWidth:   780,
    margin:     '8px auto 0',
  },
};
