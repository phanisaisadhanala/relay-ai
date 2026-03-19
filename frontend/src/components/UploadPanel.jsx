import React, { useState, useRef, useEffect, useCallback } from 'react';

export default function UploadPanel({ apiUrl, onUploadDone }) {
  const [documents, setDocuments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState('');
  const [dragOver,  setDragOver]  = useState(false);
  const [error,     setError]     = useState('');
  const [success,   setSuccess]   = useState('');
  const [ragStats,  setRagStats]  = useState(null);
  const fileRef = useRef();

  const loadDocs = useCallback(async () => {
    try {
      const r = await fetch(`${apiUrl}/documents`);
      const d = await r.json();
      setDocuments(d.documents || []);
    } catch { setDocuments([]); }
  }, [apiUrl]);

  const loadRagStats = useCallback(async () => {
    try {
      const r = await fetch(`${apiUrl}/rag/stats`);
      const d = await r.json();
      setRagStats(d);
    } catch { setRagStats(null); }
  }, [apiUrl]);

  useEffect(() => {
    loadDocs();
    loadRagStats();
  }, [loadDocs, loadRagStats]);

  // ── Upload multiple files ──────────────────────────────────
  const uploadFiles = async (files) => {
    if (!files || files.length === 0) return;

    const pdfs = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfs.length === 0) { setError('Only PDF files are supported.'); return; }

    const oversized = pdfs.filter(f => f.size / (1024*1024) > 50);
    if (oversized.length > 0) {
      setError(`File(s) too large (max 50 MB): ${oversized.map(f => f.name).join(', ')}`);
      return;
    }

    setError(''); setSuccess(''); setUploading(true);

    if (pdfs.length === 1) {
      // Single file — use /upload endpoint
      setProgress(`Uploading ${pdfs[0].name}…`);
      const formData = new FormData();
      formData.append('file', pdfs[0]);
      try {
        const r = await fetch(`${apiUrl}/upload`, { method: 'POST', body: formData });
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail || `Upload failed (${r.status})`);
        setProgress('Ingesting into vector database… (30–60s)');
        setSuccess(`"${pdfs[0].name}" uploaded. AI will reference it shortly.`);
        onUploadDone?.();
        await loadDocs();
        pollUntilReady();
      } catch (err) {
        setError(`Upload failed: ${err.message}`);
        setProgress('');
      }
    } else {
      // Multiple files — use /upload-multiple endpoint
      setProgress(`Uploading ${pdfs.length} files…`);
      const formData = new FormData();
      pdfs.forEach(f => formData.append('files', f));
      try {
        const r = await fetch(`${apiUrl}/upload-multiple`, { method: 'POST', body: formData });
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail || `Upload failed (${r.status})`);
        const saved = d.files?.filter(f => f.status === 'saved').length || 0;
        setProgress(`Ingesting ${saved} file(s)… (this may take a minute)`);
        setSuccess(`${saved} file(s) uploaded. AI will reference them shortly.`);
        onUploadDone?.();
        await loadDocs();
        pollUntilReady();
      } catch (err) {
        setError(`Upload failed: ${err.message}`);
        setProgress('');
      }
    }

    setUploading(false);
  };

  const pollUntilReady = () => {
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      try {
        const r = await fetch(`${apiUrl}/health`);
        const d = await r.json();
        if (d.rag_ready) {
          setProgress('');
          setSuccess(prev => prev + ' ✓ RAG is ready — AI is now reading your documents.');
          await loadRagStats();
          clearInterval(poll);
        } else if (attempts > 40) {
          setProgress('');
          setSuccess(prev => prev + ' Check /rag/debug if AI is not referencing documents.');
          clearInterval(poll);
        }
      } catch { clearInterval(poll); }
    }, 3000);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    uploadFiles(e.dataTransfer.files);
  };

  const deleteDoc = async (filename) => {
    if (!window.confirm(`Delete "${filename}" from the knowledge base?`)) return;
    try {
      const r = await fetch(`${apiUrl}/documents/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      if (r.ok) { setSuccess(`Deleted "${filename}"`); await loadDocs(); await loadRagStats(); }
      else        setError(`Delete failed for "${filename}"`);
    } catch (err) { setError(`Delete error: ${err.message}`); }
  };

  const chunkCount = ragStats?.stats?.chunk_count || 0;
  const sources    = ragStats?.stats?.sources || {};

  return (
    <div style={s.wrap}>
      <div style={s.inner}>

        {/* Header */}
        <div style={s.header}>
          <h1 style={s.title}>Documents</h1>
          <p style={s.sub}>
            Upload relay manuals and standards. The AI reads these documents directly when answering questions.
            <br />You can upload <strong>multiple PDFs at once</strong>.
          </p>
        </div>

        {/* RAG status card */}
        <div style={{
          ...s.statusCard,
          borderColor: chunkCount > 0 ? '#22c55e33' : '#ef444433',
          background:  chunkCount > 0 ? '#0a1a0f'   : '#1a0a0a',
        }}>
          <div style={s.statusRow}>
            <div style={{
              ...s.statusDot,
              background: chunkCount > 0 ? '#22c55e' : '#ef4444',
              boxShadow:  chunkCount > 0 ? '0 0 8px #22c55e66' : 'none',
            }} />
            <span style={{ color: chunkCount > 0 ? '#22c55e' : '#ef4444', fontWeight: 600, fontSize: 13 }}>
              {chunkCount > 0
                ? `RAG Active — ${chunkCount} chunks from ${Object.keys(sources).length} document(s)`
                : 'RAG Inactive — no documents ingested yet'}
            </span>
          </div>

          {chunkCount > 0 && (
            <div style={s.sourceList}>
              {Object.entries(sources).map(([src, count]) => (
                <div key={src} style={s.sourceChip}>
                  📄 {src} <span style={{ color: '#444' }}>({count} chunks)</span>
                </div>
              ))}
            </div>
          )}

          <div style={s.debugRow}>
            <a
              href={`${apiUrl}/rag/debug`}
              target="_blank"
              rel="noopener noreferrer"
              style={s.debugLink}
            >
              Open RAG Debug ↗
            </a>
            <button style={s.refreshBtn} onClick={() => { loadDocs(); loadRagStats(); }}>
              Refresh
            </button>
          </div>
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
          {/* multiple attribute allows selecting many files at once */}
          <input
            ref={fileRef}
            type="file"
            accept=".pdf"
            multiple
            style={{ display: 'none' }}
            onChange={e => uploadFiles(e.target.files)}
          />

          {uploading ? (
            <div style={s.uploadingState}>
              <div style={s.spinner} />
              <div style={s.progressText}>{progress}</div>
              <div style={s.progressSub}>Embedding with OpenAI text-embedding-3-small</div>
            </div>
          ) : (
            <div style={s.dropContent}>
              <UploadIcon />
              <div style={s.dropTitle}>{dragOver ? 'Drop PDFs here' : 'Upload PDFs'}</div>
              <div style={s.dropSub}>
                Drag & drop one or more PDFs · or click to browse · Max 50 MB each
              </div>
              <button
                style={s.chooseBtn}
                onClick={e => { e.stopPropagation(); fileRef.current?.click(); }}
              >
                Choose files
              </button>
            </div>
          )}
        </div>

        {error   && <div style={s.errorBox}>⚠ {error}</div>}
        {success && <div style={s.successBox}>✓ {success}</div>}

        {/* Uploaded docs */}
        <div style={s.section}>
          <div style={s.sectionHead}>
            <h2 style={s.sectionTitle}>Uploaded files ({documents.length})</h2>
          </div>

          {documents.length === 0 ? (
            <div style={s.empty}>No documents yet. Upload PDFs above.</div>
          ) : (
            <div style={s.docList}>
              {documents.map((doc, i) => {
                const chunkInfo = sources[doc.filename];
                return (
                  <div key={i} style={s.docRow}>
                    <PDFIcon />
                    <div style={s.docInfo}>
                      <div style={s.docName}>{doc.filename}</div>
                      <div style={s.docMeta}>
                        {doc.size_mb} MB
                        {chunkInfo ? ` · ${chunkInfo} chunks in vector DB` : ' · not yet ingested'}
                      </div>
                    </div>
                    <span style={{
                      ...s.badge,
                      background:   chunkInfo ? '#22c55e12' : '#f59e0b12',
                      border:       chunkInfo ? '1px solid #22c55e30' : '1px solid #f59e0b30',
                      color:        chunkInfo ? '#22c55e'  : '#f59e0b',
                    }}>
                      {chunkInfo ? 'Ready' : 'Processing…'}
                    </span>
                    <button style={s.deleteBtn} onClick={() => deleteDoc(doc.filename)} title="Remove">✕</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Troubleshooting */}
        <div style={s.troubleshoot}>
          <div style={s.troubleshootTitle}>⚡ If the AI is not reading your documents</div>
          <ol style={s.troubleshootList}>
            <li>Make sure the <strong>RAG toggle is ON</strong> in the Chat tab (green chip in input bar)</li>
            <li>Check the RAG status card above — it must show green with chunk count &gt; 0</li>
            <li>Open <a href={`${apiUrl}/rag/debug`} target="_blank" rel="noopener noreferrer" style={s.inlineLink}>RAG Debug</a> to see exactly what's being retrieved</li>
            <li>If chunk count is 0, delete and re-upload your PDF — ingestion may have failed silently</li>
            <li>Wait 60 seconds after upload before testing — ingestion runs in background</li>
          </ol>
        </div>

      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function UploadIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="#444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ marginBottom: 4 }}>
      <polyline points="16 16 12 12 8 16"/>
      <line x1="12" y1="12" x2="12" y2="21"/>
      <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
    </svg>
  );
}

function PDFIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="#555" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
    </svg>
  );
}

const s = {
  wrap:  { flex: 1, overflowY: 'auto', background: '#0f0f0f' },
  inner: { maxWidth: 700, margin: '0 auto', padding: '28px 20px 60px' },

  header: { marginBottom: 20 },
  title:  { fontSize: 22, fontWeight: 700, color: '#e8e8e8', marginBottom: 5 },
  sub:    { fontSize: 13.5, color: '#555', lineHeight: 1.7 },

  statusCard: {
    border:       '1px solid',
    borderRadius: 10,
    padding:      '14px 16px',
    marginBottom: 16,
    display:      'flex',
    flexDirection: 'column',
    gap:          10,
  },
  statusRow:  { display: 'flex', alignItems: 'center', gap: 8 },
  statusDot:  { width: 9, height: 9, borderRadius: '50%', flexShrink: 0, transition: 'all 0.3s' },
  sourceList: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  sourceChip: {
    background:   '#1a1a1a',
    border:       '1px solid #242424',
    borderRadius: 6,
    padding:      '3px 10px',
    fontSize:     12,
    color:        '#888',
  },
  debugRow:   { display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 },
  debugLink:  { color: '#3b82f6', fontSize: 12, textDecoration: 'underline' },
  refreshBtn: {
    background: 'transparent', border: '1px solid #1f1f1f',
    color: '#555', borderRadius: 6, padding: '3px 10px',
    fontSize: 11, cursor: 'pointer', fontFamily: 'inherit',
  },

  dropZone: {
    border:       '1.5px dashed',
    borderRadius: 12,
    padding:      '36px 20px',
    textAlign:    'center',
    cursor:       'pointer',
    transition:   'all 0.2s',
    marginBottom: 12,
  },
  dropContent:    { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 },
  dropTitle:      { color: '#ccc', fontSize: 15, fontWeight: 600 },
  dropSub:        { color: '#555', fontSize: 12.5, lineHeight: 1.5 },
  chooseBtn: {
    marginTop: 8, padding: '8px 20px',
    background: '#1a1a1a', border: '1px solid #2a2a2a',
    borderRadius: 8, color: '#ccc', fontWeight: 500,
    fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
  },
  uploadingState: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 },
  spinner: {
    width: 32, height: 32, borderRadius: '50%',
    border: '2px solid #1f1f1f', borderTop: '2px solid #22c55e',
    animation: 'spin 0.8s linear infinite',
  },
  progressText: { color: '#22c55e', fontWeight: 600, fontSize: 14 },
  progressSub:  { color: '#444', fontSize: 12 },

  errorBox:   { background: '#1a0a0a', border: '1px solid #3a1515', borderRadius: 8, padding: '10px 14px', color: '#f87171', fontSize: 13, marginBottom: 10 },
  successBox: { background: '#0a1a0f', border: '1px solid #1a3a22', borderRadius: 8, padding: '10px 14px', color: '#4ade80', fontSize: 13, marginBottom: 10, lineHeight: 1.6 },

  section:      { marginTop: 20 },
  sectionHead:  { marginBottom: 10 },
  sectionTitle: { fontSize: 13, fontWeight: 600, color: '#888' },
  empty: {
    background: '#141414', border: '1px dashed #1f1f1f',
    borderRadius: 10, padding: '24px', textAlign: 'center', color: '#444', fontSize: 13,
  },
  docList: { display: 'flex', flexDirection: 'column', gap: 6 },
  docRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    background: '#141414', border: '1px solid #1f1f1f',
    borderRadius: 9, padding: '10px 12px',
  },
  docInfo:  { flex: 1, minWidth: 0 },
  docName:  { color: '#ccc', fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  docMeta:  { color: '#444', fontSize: 11, marginTop: 2 },
  badge: {
    borderRadius: 20, padding: '2px 9px',
    fontSize: 11, fontWeight: 600, flexShrink: 0,
  },
  deleteBtn: {
    background: 'transparent', border: '1px solid #1f1f1f',
    color: '#444', borderRadius: 6, padding: '3px 8px',
    fontSize: 12, cursor: 'pointer', flexShrink: 0,
  },

  troubleshoot: {
    marginTop: 24, background: '#141414',
    border: '1px solid #1f1f1f', borderRadius: 10, padding: '16px 18px',
  },
  troubleshootTitle: { fontSize: 13, fontWeight: 600, color: '#aaa', marginBottom: 10 },
  troubleshootList:  { paddingLeft: 18, color: '#555', fontSize: 12.5, lineHeight: 2 },
  inlineLink: { color: '#3b82f6', textDecoration: 'underline' },
};