import React, { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import remarkGfm from 'remark-gfm';

/* ── Code theme ── */
const codeTheme = {
  'code[class*="language-"]': {
    color:      '#e2e8f0',
    background: 'transparent',
    fontFamily: "'Geist Mono', 'Courier New', monospace",
    fontSize:   '13px',
    lineHeight: '1.7',
  },
  'comment':   { color: '#4a5568', fontStyle: 'italic' },
  'keyword':   { color: '#68d391', fontWeight: '600' },
  'string':    { color: '#f6ad55' },
  'function':  { color: '#76e4f7' },
  'number':    { color: '#f6ad55' },
  'operator':  { color: '#68d391' },
  'variable':  { color: '#e2e8f0' },
  'class-name':{ color: '#76e4f7' },
  'boolean':   { color: '#f6ad55' },
  'builtin':   { color: '#68d391' },
  'punctuation':{ color: '#718096' },
};

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy} style={{
      background:   copied ? '#22c55e22' : 'transparent',
      border:       `1px solid ${copied ? '#22c55e55' : '#2a2a2a'}`,
      color:        copied ? '#22c55e' : '#555',
      borderRadius: 5,
      padding:      '3px 10px',
      fontSize:     11,
      cursor:       'pointer',
      transition:   'all 0.2s',
      fontFamily:   'inherit',
    }}>
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  );
}

function CodeBlock({ language, children }) {
  const code = String(children).trim();
  const lang = language || 'text';

  const langLabel =
    lang === 'vba' || lang === 'vb' ? 'VBA · CAPE MACRO'
    : lang === 'python'             ? 'Python'
    : lang === 'bash' || lang === 'sh' ? 'Shell'
    : lang === 'json'               ? 'JSON'
    : lang.toUpperCase();

  return (
    <div style={cs.codeWrap}>
      <div style={cs.codeHeader}>
        <span style={cs.codeLang}>{langLabel}</span>
        <CopyBtn text={code} />
      </div>
      <SyntaxHighlighter
        language={lang === 'vba' || lang === 'vb' ? 'vbnet' : lang}
        style={codeTheme}
        customStyle={{
          margin:       0,
          padding:      '16px',
          background:   '#0a0a0a',
          borderRadius: '0 0 8px 8px',
          fontSize:     '13px',
          lineHeight:   '1.7',
          overflowX:    'auto',
        }}
        wrapLongLines
      >
        {code}
      </SyntaxHighlighter>
    </div>
  );
}

export default function MessageBubble({ message }) {
  const isUser  = message.role === 'user';
  const isError = message.error;

  if (isUser) {
    return (
      <div style={{ ...cs.row, justifyContent: 'flex-end', animation: 'fadeUp 0.25s ease' }}>
        <div style={cs.userBubble}>{message.content}</div>
      </div>
    );
  }

  return (
    <div style={{ ...cs.row, animation: 'fadeUp 0.25s ease' }}>
      <div style={cs.aiAvatar}>⚡</div>
      <div style={{ ...cs.aiBubble, opacity: isError ? 0.8 : 1 }}>
        {message.streaming && !message.content && (
          <span style={{ color: '#555', fontSize: 13 }}>Thinking…</span>
        )}

        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            code({ node, inline, className, children }) {
              const lang = (className || '').replace('language-', '');
              if (inline) {
                return (
                  <code style={cs.inlineCode}>{children}</code>
                );
              }
              return <CodeBlock language={lang}>{children}</CodeBlock>;
            },
            p:          ({ children }) => <p style={cs.para}>{children}</p>,
            h1:         ({ children }) => <h2 style={cs.h1}>{children}</h2>,
            h2:         ({ children }) => <h2 style={cs.h2}>{children}</h2>,
            h3:         ({ children }) => <h3 style={cs.h3}>{children}</h3>,
            ul:         ({ children }) => <ul style={cs.ul}>{children}</ul>,
            ol:         ({ children }) => <ol style={cs.ol}>{children}</ol>,
            li:         ({ children }) => <li style={cs.li}>{children}</li>,
            table:      ({ children }) => (
              <div style={{ overflowX: 'auto', margin: '12px 0' }}>
                <table style={cs.table}>{children}</table>
              </div>
            ),
            th:         ({ children }) => <th style={cs.th}>{children}</th>,
            td:         ({ children }) => <td style={cs.td}>{children}</td>,
            blockquote: ({ children }) => <blockquote style={cs.blockquote}>{children}</blockquote>,
            hr:         () => <hr style={cs.hr} />,
            strong:     ({ children }) => <strong style={{ color: '#e2e8f0', fontWeight: 600 }}>{children}</strong>,
            a:          ({ href, children }) => (
              <a href={href} target="_blank" rel="noopener noreferrer" style={cs.link}>{children}</a>
            ),
          }}
        >
          {message.content}
        </ReactMarkdown>

        {message.streaming && message.content && (
          <span style={cs.cursor} />
        )}
      </div>
    </div>
  );
}

const cs = {
  row: {
    display:   'flex',
    alignItems: 'flex-start',
    gap:        12,
    padding:   '6px 0',
    maxWidth:  780,
    width:     '100%',
    margin:    '0 auto',
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
    marginTop:       2,
  },
  aiBubble: {
    flex:         1,
    fontSize:     14,
    lineHeight:   1.75,
    color:        '#d4d4d4',
    wordBreak:    'break-word',
    minWidth:     0,
  },
  userBubble: {
    maxWidth:     '72%',
    padding:      '10px 15px',
    background:   '#1a1a1a',
    border:       '1px solid #242424',
    borderRadius: '14px 4px 14px 14px',
    fontSize:     14,
    lineHeight:   1.65,
    color:        '#e8e8e8',
    wordBreak:    'break-word',
  },
  inlineCode: {
    background:   '#1a1a1a',
    border:       '1px solid #242424',
    padding:      '1px 6px',
    borderRadius: 4,
    fontFamily:   "'Geist Mono', 'Courier New', monospace",
    fontSize:     '12.5px',
    color:        '#22c55e',
  },
  codeWrap: {
    margin:       '10px 0',
    borderRadius: 9,
    overflow:     'hidden',
    border:       '1px solid #1f1f1f',
  },
  codeHeader: {
    display:         'flex',
    justifyContent:  'space-between',
    alignItems:      'center',
    background:      '#141414',
    padding:         '6px 14px',
    borderBottom:    '1px solid #1f1f1f',
  },
  codeLang: {
    color:      '#555',
    fontSize:   11,
    fontFamily: "'Geist Mono', monospace",
    fontWeight: 500,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  para:       { margin: '4px 0', lineHeight: 1.75 },
  h1:         { color: '#e2e8f0', fontSize: 17, fontWeight: 700, margin: '16px 0 6px', borderBottom: '1px solid #1f1f1f', paddingBottom: 6 },
  h2:         { color: '#d4d4d4', fontSize: 15, fontWeight: 600, margin: '12px 0 5px' },
  h3:         { color: '#c0c0c0', fontSize: 14, fontWeight: 600, margin: '10px 0 4px' },
  ul:         { paddingLeft: 20, margin: '6px 0' },
  ol:         { paddingLeft: 20, margin: '6px 0' },
  li:         { marginBottom: 4, lineHeight: 1.65 },
  table:      { borderCollapse: 'collapse', fontSize: 13, width: '100%' },
  th:         { background: '#141414', color: '#d4d4d4', padding: '7px 12px', textAlign: 'left', fontWeight: 600, border: '1px solid #1f1f1f', fontSize: 12 },
  td:         { padding: '6px 12px', border: '1px solid #1f1f1f', color: '#aaa' },
  blockquote: { borderLeft: '3px solid #22c55e44', paddingLeft: 14, margin: '8px 0', color: '#666', fontStyle: 'italic' },
  hr:         { border: 'none', borderTop: '1px solid #1f1f1f', margin: '12px 0' },
  link:       { color: '#22c55e', textDecoration: 'underline', textUnderlineOffset: 3 },
  cursor:     {
    display:         'inline-block',
    width:           2,
    height:          16,
    background:      '#22c55e',
    marginLeft:      2,
    verticalAlign:   'middle',
    animation:       'blink 1s ease infinite',
  },
};
