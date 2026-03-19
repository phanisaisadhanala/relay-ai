import React, { useState, useRef, useEffect, useCallback } from 'react';

export default function UploadPanel({ apiUrl, onUploadDone }) {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState('');
  const [dragOver,  setDragOver]  = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const fileRef = useRef();

  const loadDocs = useCallback(async () => {
    try {
      const r = await fetch(`${apiUrl}/documents`);
      const d = await r.json();
      setDocuments(d.documents || []);
    } catch { setDocuments([]); }
  }, [apiUrl]);

  useEffect(() => { loadDocs(); }, [loadDocs]);

  const uploadFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setError('Only PDF files are supported.'); return;
    }
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > 50) { setError(`File too large (${sizeMB.toFixed(1)} MB). Max 50 MB.`); return; }

    setError(''); setSuccess(''); setUploading(true);
    setProgress(`Uploading ${file.name}…`);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const r = await fetch(`${apiUrl}/upload`, { method: 'POST', body: formData });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `Upload failed (${r.status})`);

      setProgress('Ingesting into vector database… (~30s)');
      setSuccess(`"${file.name}" uploaded. Ingestion running in background.`);
      onUploadDone?.();
      await loadDocs();

      let attempts = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const hr = await fetch(`${apiUrl}/health`);
          const hd = await hr.json();
          if (hd.rag_ready) {
            setProgress('');
            setSuccess(`"${file.name}" is ready — AI now references this document.`);
            clearInterval(poll);
          } else if (attempts > 30) { setProgress(''); clearInterval(poll); }
        } catch { clearInterval(poll); }
      }, 2000);

    } catch (err) {
      setError(`Upload failed: ${err.message}`);
      setProgress('');
    }
    setUploading(false);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) uploadFile(file);
  };

  const deleteDoc = async (filename) => {
    if (!window.confirm(`Delete "${filename}" from the knowledge base?`)) return;
    try {
      const r = await fetch(`${apiUrl}/documents/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (r.ok) { setSuccess(`Deleted "${filename}"`); await loadDocs(); }
      else        setError(`Delete failed for "${filename}"`);
    } catch (err) { setError(`Delete error: ${err.message}`); }
  };

  const RECOMMENDED = [
    { icon: '📘', title: 'APA / CAPE User Manual',      desc: 'CAPE macro object model & API reference' },
    { icon: '📗', title: 'SEL Relay Instruction Manual', desc: 'Relay settings, logic, SELOGIC equations' },
    { icon: '📙', title: 'IEEE C37.113 / C37.116',       desc: 'Line protection performance standards' },
    { icon: '📕', title: 'CUPL Reference Manual',        desc: 'CAPE programming language reference' },
    { icon: '📒', title: 'NERC PRC Standards',           desc: 'PRC-023/025/026/027 compliance' },
    { icon: '📓', title: 'Relay Calculation Sheets',     desc: 'Project-specific data and settings' },
  ];

  return (
    <div style={s.wrap}>
      <div style={s.inner}>

        {/* Header */}
        <div style={s.header}>
          <h1 style={s.title}>Documents</h1>
          <p style={s.sub}>Upload relay manuals and standards. The AI references them when answering questions.</p>
        </div>

        {/* Drop zone */}
        <div
          style={{
            ...s.dropZone,
            borderColor: dragOver ? '#22c55e' : uploading ? '#22c55e44' : '#242424',
            background:  dragOver ? '#22c55e08' : '#141414',
          }}
          onDragOver={e => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => !uploading && fileRef.current?.click()}
        >
          <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }}
            onChange={e => uploadFile(e.target.files[0])} />

          {uploading ? (
            <div style={s.uploadingState}>
              <div style={s.spinner} />
              <div style={s.progressText}>{progress}</div>
              <div style={s.progressSub}>Using OpenAI text-embedding-3-small</div>
            </div>
          ) : (
            <div style={s.dropContent}>
              <div style={s.dropIcon}>
                <UploadIcon />
              </div>
              <div style={s.dropTitle}>{dragOver ? 'Drop PDF here' : 'Upload a PDF'}</div>
              <div style={s.dropSub}>Drag & drop or click to browse · PDF only · Max 50 MB</div>
              <button style={s.chooseBtn} onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}>
                Choose file
              </button>
            </div>
          )}
        </div>

        {/* Feedback */}
        {error   && <div style={s.errorBox}><span>⚠</span> {error}</div>}
        {success && <div style={s.successBox}><span>✓</span> {success}</div>}

        {/* Uploaded docs */}
        <div style={s.section}>
          <div style={s.sectionHead}>
            <h2 style={s.sectionTitle}>Uploaded documents ({documents.length})</h2>
            <button style={s.refreshBtn} onClick={loadDocs}>Refresh</button>
          </div>

          {documents.length === 0 ? (
            <div style={s.empty}>No documents yet. Upload a PDF above to enable document search.</div>
          ) : (
            <div style={s.docList}>
              {documents.map((doc, i) => (
                <div key={i} style={s.docRow}>
                  <div style={s.docIcon}>
                    <PDFIcon />
                  </div>
                  <div style={s.docInfo}>
                    <div style={s.docName}>{doc.filename}</div>
                    <div style={s.docMeta}>{doc.size_mb} MB · PDF · Ingested</div>
                  </div>
                  <span style={s.readyBadge}>Ready</span>
                  <button style={s.deleteBtn} onClick={() => deleteDoc(doc.filename)} title="Remove">✕</button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recommended */}
        <div style={s.section}>
          <h2 style={s.sectionTitle}>Recommended documents to upload</h2>
          <div style={s.recGrid}>
            {RECOMMENDED.map((d, i) => (
              <div key={i} style={s.recCard}>
                <span style={s.recIcon}>{d.icon}</span>
                <div>
                  <div style={s.recTitle}>{d.title}</div>
                  <div style={s.recDesc}>{d.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How RAG works */}
        <div style={s.ragInfo}>
          <h2 style={s.sectionTitle}>How RAG works</h2>
          <div style={s.ragSteps}>
            {[
              ['Upload', 'PDF saved to backend/docs/'],
              ['Extract', 'PyPDFLoader reads every page'],
              ['Chunk', '1000-char chunks, 200-char overlap'],
              ['Embed', 'OpenAI text-embedding-3-small'],
              ['Store', 'ChromaDB vector database'],
              ['Retrieve', 'Top-5 similar chunks per query'],
              ['Answer', 'LLM + document context combined'],
            ].map(([title, detail], i) => (
              <div key={i} style={s.ragStep}>
                <div style={s.ragN}>{i + 1}</div>
                <div>
                  <div style={s.ragStepTitle}>{title}</div>
                  <div style={s.ragStepDetail}>{detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  );
}

function PDFIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

const s = {
  wrap:  { flex: 1, overflowY: 'auto', background: '#0f0f0f' },
  inner: { maxWidth: 700, margin: '0 auto', padding: '28px 20px 60px' },

  header:  { marginBottom: 24 },
  title:   { fontSize: 22, fontWeight: 700, color: '#e8e8e8', marginBottom: 5 },
  sub:     { fontSize: 13.5, color: '#555', lineHeight: 1.6 },

  dropZone: {
    border:       '1.5px dashed',
    borderRadius: 12,
    padding:      '36px 20px',
    textAlign:    'center',
    cursor:       'pointer',
    transition:   'all 0.2s',
    marginBottom: 14,
  },
  dropContent: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  dropIcon:    { opacity: 0.5, marginBottom: 4 },
  dropTitle:   { color: '#ccc', fontSize: 15, fontWeight: 600 },
  dropSub:     { color: '#555', fontSize: 12.5 },
  chooseBtn: {
    marginTop:    8,
    padding:      '8px 20px',
    background:   '#1a1a1a',
    border:       '1px solid #2a2a2a',
    borderRadius: 8,
    color:        '#ccc',
    fontWeight:   500,
    fontSize:     13,
    cursor:       'pointer',
    fontFamily:   'inherit',
    transition:   'all 0.15s',
  },
  uploadingState: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  spinner: {
    width:        32,
    height:       32,
    borderRadius: '50%',
    border:       '2px solid #1f1f1f',
    borderTop:    '2px solid #22c55e',
    animation:    'spin 0.8s linear infinite',
  },
  progressText: { color: '#22c55e', fontWeight: 600, fontSize: 14 },
  progressSub:  { color: '#444', fontSize: 12 },

  errorBox:   { background: '#1a0a0a', border: '1px solid #3a1515', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 12, display: 'flex', gap: 8 },
  successBox: { background: '#0a1a0f', border: '1px solid #1a3a22', borderRadius: 8, padding: '10px 14px', color: '#4ade80', fontSize: 13, marginBottom: 12, display: 'flex', gap: 8 },

  section:     { marginTop: 24 },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontWeight: 600, color: '#aaa' },
  refreshBtn: {
    background:   'transparent',
    border:       '1px solid #1f1f1f',
    color:        '#555',
    borderRadius: 6,
    padding:      '4px 10px',
    fontSize:     11,
    cursor:       'pointer',
    fontFamily:   'inherit',
  },
  empty: {
    background:   '#141414',
    border:       '1px dashed #1f1f1f',
    borderRadius: 10,
    padding:      '24px',
    textAlign:    'center',
    color:        '#444',
    fontSize:     13,
  },
  docList:   { display: 'flex', flexDirection: 'column', gap: 6 },
  docRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        10,
    background: '#141414',
    border:     '1px solid #1f1f1f',
    borderRadius: 9,
    padding:    '10px 12px',
  },
  docIcon:   { flexShrink: 0, opacity: 0.6 },
  docInfo:   { flex: 1, minWidth: 0 },
  docName:   { color: '#ccc', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  docMeta:   { color: '#444', fontSize: 11, marginTop: 2 },
  readyBadge: {
    background:   '#22c55e12',
    border:       '1px solid #22c55e30',
    color:        '#22c55e',
    borderRadius: 20,
    padding:      '2px 9px',
    fontSize:     11,
    fontWeight:   600,
    flexShrink:   0,
  },
  deleteBtn: {
    background:   'transparent',
    border:       '1px solid #1f1f1f',
    color:        '#444',
    borderRadius: 6,
    padding:      '3px 8px',
    fontSize:     12,
    cursor:       'pointer',
    transition:   'all 0.15s',
    flexShrink:   0,
  },

  recGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 8 },
  recCard: {
    display:    'flex',
    gap:        10,
    alignItems: 'flex-start',
    background: '#141414',
    border:     '1px solid #1f1f1f',
    borderRadius: 8,
    padding:    '11px 12px',
  },
  recIcon:  { fontSize: 20, flexShrink: 0 },
  recTitle: { color: '#aaa', fontSize: 12, fontWeight: 600, marginBottom: 2 },
  recDesc:  { color: '#444', fontSize: 11, lineHeight: 1.4 },

  ragInfo:  { marginTop: 24, background: '#141414', border: '1px solid #1f1f1f', borderRadius: 12, padding: '18px 20px' },
  ragSteps: { display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  ragStep:  {
    display:    'flex',
    gap:        8,
    alignItems: 'flex-start',
    background: '#0f0f0f',
    borderRadius: 8,
    padding:    '8px 10px',
    flex:       '1 1 170px',
    border:     '1px solid #1a1a1a',
  },
  ragN: {
    width:           20,
    height:          20,
    borderRadius:    5,
    background:      '#1a2a1a',
    color:           '#22c55e',
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    fontSize:        10,
    fontWeight:      700,
    flexShrink:      0,
  },
  ragStepTitle:  { color: '#888', fontSize: 12, fontWeight: 600 },
  ragStepDetail: { color: '#444', fontSize: 11, marginTop: 2, lineHeight: 1.4 },
};
