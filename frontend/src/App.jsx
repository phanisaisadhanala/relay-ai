import React, { useState, useEffect } from 'react';
import ChatWindow  from './components/ChatWindow';
import UploadPanel from './components/UploadPanel';
import FaultCalc   from './components/FaultCalc';

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const NAV = [
  { id: 'chat',  icon: ChatIcon,    label: 'Chat' },
  { id: 'calc',  icon: CalcIcon,    label: 'Fault Calc' },
  { id: 'docs',  icon: DocsIcon,    label: 'Documents' },
];

export default function App() {
  const [tab,          setTab]          = useState('chat');
  const [status,       setStatus]       = useState('checking');
  const [ragReady,     setRagReady]     = useState(false);
  const [docCount,     setDocCount]     = useState(0);
  const [sidebarOpen,  setSidebarOpen]  = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${API}/health`);
        const d = await r.json();
        setStatus(d.status === 'ok' ? 'online' : 'degraded');
        setRagReady(d.rag_ready || false);
        setDocCount(d.docs_count || 0);
      } catch {
        setStatus('offline');
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <div style={s.root}>
      {/* ── Sidebar ── */}
      <aside style={{ ...s.sidebar, width: sidebarOpen ? 220 : 60 }}>
        {/* Logo */}
        <div style={s.logo}>
          <div style={s.logoMark}>⚡</div>
          {sidebarOpen && (
            <div>
              <div style={s.logoName}>Relay AI</div>
              <div style={s.logoSub}>Protection Engineer</div>
            </div>
          )}
        </div>

        {/* Nav */}
        <nav style={s.nav}>
          {NAV.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              style={{
                ...s.navBtn,
                background: tab === id ? '#1a1a1a' : 'transparent',
                color:      tab === id ? '#fff' : '#888',
              }}
              onClick={() => setTab(id)}
              title={label}
            >
              <Icon size={18} active={tab === id} />
              {sidebarOpen && <span style={s.navLabel}>{label}</span>}
              {id === 'docs' && ragReady && sidebarOpen && (
                <span style={s.navBadge}>{docCount}</span>
              )}
            </button>
          ))}
        </nav>

        {/* Footer */}
        <div style={s.sidebarFooter}>
          {/* Status dot */}
          <div style={s.statusRow}>
            <div style={{
              ...s.statusDot,
              background: status === 'online' ? '#22c55e'
                        : status === 'checking' ? '#f59e0b'
                        : '#ef4444',
              boxShadow: status === 'online' ? '0 0 6px #22c55e88' : 'none',
            }} />
            {sidebarOpen && (
              <span style={s.statusLabel}>
                {status === 'online' ? 'Connected'
               : status === 'checking' ? 'Connecting…'
               : 'Offline'}
              </span>
            )}
          </div>

          {/* Collapse toggle */}
          <button
            style={s.collapseBtn}
            onClick={() => setSidebarOpen(v => !v)}
            title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarOpen ? '←' : '→'}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main style={s.main}>
        {tab === 'chat' && <ChatWindow  apiUrl={API} ragReady={ragReady} />}
        {tab === 'calc' && <FaultCalc   apiUrl={API} />}
        {tab === 'docs' && (
          <UploadPanel
            apiUrl={API}
            onUploadDone={() => { setRagReady(true); setDocCount(c => c + 1); }}
          />
        )}
      </main>

      <style>{globalCSS}</style>
    </div>
  );
}

/* ── Icons ── */
function ChatIcon({ size, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={active ? '#fff' : 'currentColor'} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  );
}
function CalcIcon({ size, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={active ? '#fff' : 'currentColor'} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2"/>
      <line x1="8" y1="6" x2="16" y2="6"/>
      <line x1="8" y1="10" x2="10" y2="10"/>
      <line x1="12" y1="10" x2="14" y2="10"/>
      <line x1="16" y1="10" x2="16" y2="10"/>
      <line x1="8" y1="14" x2="10" y2="14"/>
      <line x1="12" y1="14" x2="14" y2="14"/>
      <line x1="16" y1="14" x2="16" y2="14"/>
      <line x1="8" y1="18" x2="10" y2="18"/>
      <line x1="12" y1="18" x2="14" y2="18"/>
      <line x1="16" y1="18" x2="16" y2="18"/>
    </svg>
  );
}
function DocsIcon({ size, active }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke={active ? '#fff' : 'currentColor'} strokeWidth="1.8"
      strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <line x1="9" y1="13" x2="15" y2="13"/>
      <line x1="9" y1="17" x2="13" y2="17"/>
    </svg>
  );
}

/* ── Styles ── */
const s = {
  root: {
    display:       'flex',
    height:        '100vh',
    background:    '#0f0f0f',
    overflow:      'hidden',
  },
  sidebar: {
    display:        'flex',
    flexDirection:  'column',
    background:     '#141414',
    borderRight:    '1px solid #1f1f1f',
    flexShrink:     0,
    transition:     'width 0.2s ease',
    overflow:       'hidden',
  },
  logo: {
    display:    'flex',
    alignItems: 'center',
    gap:        10,
    padding:    '18px 14px 14px',
    borderBottom: '1px solid #1f1f1f',
    flexShrink: 0,
  },
  logoMark: {
    width:           34,
    height:          34,
    borderRadius:    8,
    background:      'linear-gradient(135deg, #16a34a, #15803d)',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    fontSize:        16,
    flexShrink:      0,
  },
  logoName: { fontSize: 14, fontWeight: 700, color: '#fff', lineHeight: 1.2 },
  logoSub:  { fontSize: 10, color: '#555', marginTop: 1 },
  nav: {
    flex:          1,
    padding:       '10px 8px',
    display:       'flex',
    flexDirection: 'column',
    gap:           2,
  },
  navBtn: {
    display:     'flex',
    alignItems:  'center',
    gap:         10,
    padding:     '9px 10px',
    borderRadius: 8,
    border:      'none',
    cursor:      'pointer',
    transition:  'all 0.15s',
    textAlign:   'left',
    width:       '100%',
    whiteSpace:  'nowrap',
  },
  navLabel: { fontSize: 13.5, fontWeight: 500 },
  navBadge: {
    marginLeft:   'auto',
    background:   '#22c55e22',
    color:        '#22c55e',
    borderRadius: 10,
    padding:      '1px 7px',
    fontSize:     11,
    fontWeight:   600,
  },
  sidebarFooter: {
    padding:      '10px 12px',
    borderTop:    '1px solid #1f1f1f',
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'space-between',
    flexShrink:   0,
  },
  statusRow:  { display: 'flex', alignItems: 'center', gap: 7 },
  statusDot:  { width: 8, height: 8, borderRadius: '50%', flexShrink: 0, transition: 'all 0.3s' },
  statusLabel: { fontSize: 11.5, color: '#555' },
  collapseBtn: {
    background:   'transparent',
    border:       '1px solid #242424',
    color:        '#555',
    borderRadius: 6,
    width:        28,
    height:       28,
    cursor:       'pointer',
    fontSize:     13,
    display:      'flex',
    alignItems:   'center',
    justifyContent: 'center',
    transition:   'all 0.15s',
    flexShrink:   0,
  },
  main: {
    flex:     1,
    overflow: 'hidden',
    display:  'flex',
  },
};

const globalCSS = `
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0; }
  }
  .nav-btn:hover { background: #1a1a1a !important; color: #ccc !important; }
  .collapse-btn:hover { border-color: #333 !important; color: #888 !important; }
`;
