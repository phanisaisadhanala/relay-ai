import React, { useState } from 'react';

const FAULT_TYPES = [
  { id: 'SLG', label: 'SLG',  full: 'Single Line-to-Ground',  color: '#f59e0b', formula: 'Ia = 3·Vf / (Z1 + Z2 + Z0 + 3·Zf)' },
  { id: 'LL',  label: 'LL',   full: 'Line-to-Line',           color: '#22c55e', formula: 'Ia1 = Vf / (Z1 + Z2 + Zf)' },
  { id: 'DLG', label: 'DLG',  full: 'Double Line-to-Ground',  color: '#3b82f6', formula: 'Z_par = Z2∥(Z0+3Zf);  Ia1 = Vf/(Z1+Z_par)' },
  { id: '3PH', label: '3PH',  full: 'Three Phase Balanced',   color: '#a855f7', formula: 'Ia = Vf / (Z1 + Zf)' },
];

export default function FaultCalc({ apiUrl }) {
  const [faultType, setFaultType] = useState('SLG');
  const [form,      setForm]      = useState({
    voltage_kv: '132',
    z1_mag: '3.2', z1_ang: '80',
    z2_mag: '3.2', z2_ang: '80',
    z0_mag: '9.6', z0_ang: '70',
    zf_mag: '0',   zf_ang: '0',
  });
  const [result,  setResult]  = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const calculate = async () => {
    setError(''); setResult(null); setLoading(true);
    const body = {
      fault_type: faultType,
      voltage_kv: parseFloat(form.voltage_kv),
      z1_mag: parseFloat(form.z1_mag), z1_ang: parseFloat(form.z1_ang),
      z2_mag: parseFloat(form.z2_mag) || null, z2_ang: parseFloat(form.z2_ang),
      z0_mag: parseFloat(form.z0_mag) || null, z0_ang: parseFloat(form.z0_ang),
      zf_mag: parseFloat(form.zf_mag) || 0,    zf_ang: parseFloat(form.zf_ang) || 0,
    };
    try {
      const r = await fetch(`${apiUrl}/calculate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || 'Calculation failed');
      setResult(d);
    } catch (err) {
      setError(err.message.includes('fetch')
        ? 'Cannot connect to backend. Is uvicorn running on port 8000?'
        : err.message);
    }
    setLoading(false);
  };

  const sel = FAULT_TYPES.find(t => t.id === faultType);

  return (
    <div style={s.wrap}>
      <div style={s.inner}>

        {/* Header */}
        <div style={s.header}>
          <h1 style={s.title}>Fault Calculator</h1>
          <p style={s.sub}>Sequence network analysis with step-by-step working</p>
        </div>

        {/* Fault type tabs */}
        <div style={s.tabs}>
          {FAULT_TYPES.map(t => (
            <button
              key={t.id}
              style={{
                ...s.tab,
                background:  faultType === t.id ? '#1a1a1a' : 'transparent',
                borderColor: faultType === t.id ? t.color + '66' : '#1f1f1f',
                color:       faultType === t.id ? t.color : '#555',
              }}
              onClick={() => { setFaultType(t.id); setResult(null); }}
            >
              <span style={s.tabLabel}>{t.label}</span>
              <span style={s.tabFull}>{t.full}</span>
            </button>
          ))}
        </div>

        {/* Formula */}
        <div style={{ ...s.formula, borderColor: sel.color + '33' }}>
          <span style={s.formulaLabel}>Formula</span>
          <code style={{ ...s.formulaCode, color: sel.color }}>{sel.formula}</code>
        </div>

        {/* Form */}
        <div style={s.form}>
          {/* Voltage */}
          <div style={s.section}>
            <label style={s.sectionLabel}>System Voltage</label>
            <div style={s.inputRow}>
              <input
                type="number" value={form.voltage_kv}
                onChange={set('voltage_kv')} style={{ ...s.input, flex: 1 }}
                placeholder="132"
              />
              <span style={s.unit}>kV  (line-to-line)</span>
            </div>
          </div>

          {/* Z1 */}
          <ImpRow label="Z1 — Positive Sequence" hint="Required for all fault types"
            mag={form.z1_mag} onMag={set('z1_mag')}
            ang={form.z1_ang} onAng={set('z1_ang')} accent />

          {/* Z2 */}
          {faultType !== '3PH' && (
            <ImpRow label="Z2 — Negative Sequence" hint="Typically equal to Z1 for lines"
              mag={form.z2_mag} onMag={set('z2_mag')}
              ang={form.z2_ang} onAng={set('z2_ang')} />
          )}

          {/* Z0 */}
          {(faultType === 'SLG' || faultType === 'DLG') && (
            <ImpRow label="Z0 — Zero Sequence" hint="Typically 3× Z1 for overhead lines"
              mag={form.z0_mag} onMag={set('z0_mag')}
              ang={form.z0_ang} onAng={set('z0_ang')} />
          )}

          {/* Zf */}
          <ImpRow label="Zf — Fault Impedance" hint="Set to 0 for a bolted fault"
            mag={form.zf_mag} onMag={set('zf_mag')}
            ang={form.zf_ang} onAng={set('zf_ang')} />
        </div>

        {/* Button */}
        <button
          style={{
            ...s.calcBtn,
            background: loading ? '#1a1a1a' : sel.color,
            color:      loading ? '#555'    : '#000',
            cursor:     loading ? 'wait'    : 'pointer',
          }}
          onClick={calculate}
          disabled={loading}
        >
          {loading ? (
            <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
              <span style={s.spinner} />
              Calculating…
            </span>
          ) : `Calculate ${faultType} Fault`}
        </button>

        {/* Error */}
        {error && (
          <div style={s.errorBox}>
            <span style={{ marginRight: 6 }}>⚠</span>{error}
          </div>
        )}

        {/* Results */}
        {result && <Results result={result} color={sel.color} />}

      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

function ImpRow({ label, hint, mag, onMag, ang, onAng, accent }) {
  return (
    <div style={s.section}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <label style={{ ...s.sectionLabel, marginBottom: 0 }}>{label}</label>
        {hint && <span style={s.hint}>{hint}</span>}
      </div>
      <div style={s.impCols}>
        <div>
          <span style={s.subLabel}>Magnitude</span>
          <div style={s.inputRow}>
            <input type="number" value={mag} onChange={onMag}
              style={{ ...s.input, borderColor: accent ? '#22c55e22' : undefined }} />
            <span style={s.unit}>Ω</span>
          </div>
        </div>
        <div>
          <span style={s.subLabel}>Angle</span>
          <div style={s.inputRow}>
            <input type="number" value={ang} onChange={onAng} style={s.input} />
            <span style={s.unit}>°</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Results({ result, color }) {
  const [showAI, setShowAI] = useState(true);

  return (
    <div style={s.results}>
      {/* Summary */}
      <div style={{ ...s.card, borderColor: color + '33' }}>
        <div style={s.cardTitle}>
          <span style={{ color }}>{result.fault_type} Fault</span>
          <span style={s.cardSub}>{result.voltage_kv} kV system</span>
        </div>
        <div style={s.summaryGrid}>
          <StatCell label="Fault Current (A)" value={`${result.ia_primary_A?.toLocaleString()} A`} big color={color} />
          <StatCell label="Magnitude (pu)"    value={`${result.ia_pu} pu`} />
          <StatCell label="Angle"             value={`${result.ia_angle_deg}°`} />
          <StatCell label="Ia1 (pos seq)"     value={result.ia1_pu} />
          <StatCell label="Ia2 (neg seq)"     value={result.ia2_pu} />
          <StatCell label="Ia0 (zero seq)"    value={result.ia0_pu} />
        </div>
      </div>

      {/* Steps */}
      <div style={s.card}>
        <div style={s.cardTitle}>Step-by-Step Calculation</div>
        {result.steps?.map((step, i) => (
          <div key={i} style={s.step}>
            <div style={s.stepHead}>
              <div style={{ ...s.stepNum, background: color }}>{step.step}</div>
              <span style={s.stepTitle}>{step.title}</span>
            </div>
            <pre style={s.stepPre}>{step.content}</pre>
          </div>
        ))}
      </div>

      {/* AI interpretation */}
      {result.ai_interpretation && (
        <div style={s.card}>
          <button style={s.aiToggle} onClick={() => setShowAI(v => !v)}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={s.aiDot} />
              AI Engineering Interpretation
            </span>
            <span style={s.aiChevron}>{showAI ? '▲' : '▼'}</span>
          </button>
          {showAI && <div style={s.aiText}>{result.ai_interpretation}</div>}
        </div>
      )}
    </div>
  );
}

function StatCell({ label, value, big, color }) {
  return (
    <div style={s.statCell}>
      <div style={s.statLabel}>{label}</div>
      <div style={{
        ...s.statValue,
        color:    big ? color : '#d4d4d4',
        fontSize: big ? 20   : 13,
      }}>{value}</div>
    </div>
  );
}

const s = {
  wrap:  { flex: 1, overflowY: 'auto', padding: '0 20px 60px', background: '#0f0f0f' },
  inner: { maxWidth: 720, margin: '0 auto', paddingTop: 28 },

  header:  { marginBottom: 24 },
  title:   { fontSize: 22, fontWeight: 700, color: '#e8e8e8', marginBottom: 5 },
  sub:     { fontSize: 13.5, color: '#555' },

  tabs: { display: 'flex', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
  tab: {
    flex:           '1 1 110px',
    display:        'flex',
    flexDirection:  'column',
    alignItems:     'center',
    padding:        '10px 8px',
    borderRadius:   9,
    border:         '1px solid',
    cursor:         'pointer',
    transition:     'all 0.15s',
    fontFamily:     'inherit',
    minWidth:       90,
  },
  tabLabel: { fontSize: 15, fontWeight: 700 },
  tabFull:  { fontSize: 10.5, marginTop: 2, color: '#666' },

  formula: {
    display:      'flex',
    alignItems:   'center',
    gap:          10,
    background:   '#141414',
    border:       '1px solid',
    borderRadius: 8,
    padding:      '9px 14px',
    marginBottom: 20,
  },
  formulaLabel: { color: '#444', fontSize: 11, fontWeight: 500, flexShrink: 0 },
  formulaCode:  {
    fontFamily: "'Geist Mono', monospace",
    fontSize:   12.5,
    fontWeight: 500,
    letterSpacing: '-0.01em',
  },

  form:     { display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 16 },
  section:  { background: '#141414', border: '1px solid #1f1f1f', borderRadius: 10, padding: '14px 16px' },
  sectionLabel: { display: 'block', color: '#aaa', fontSize: 12.5, fontWeight: 600, marginBottom: 10 },
  hint:     { color: '#444', fontSize: 11, fontStyle: 'italic' },
  subLabel: { display: 'block', color: '#444', fontSize: 11, marginBottom: 5 },
  impCols:  { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  inputRow: { display: 'flex', alignItems: 'center', gap: 8 },
  input: {
    flex:         1,
    background:   '#0f0f0f',
    border:       '1px solid #242424',
    borderRadius: 7,
    padding:      '8px 10px',
    color:        '#e2e8f0',
    fontSize:     13.5,
    fontFamily:   "'Geist Mono', monospace",
    outline:      'none',
    transition:   'border-color 0.15s',
    width:        '100%',
  },
  unit: { color: '#444', fontSize: 12, flexShrink: 0 },

  calcBtn: {
    width:        '100%',
    padding:      '13px',
    borderRadius: 10,
    border:       'none',
    fontWeight:   700,
    fontSize:     14,
    fontFamily:   'inherit',
    transition:   'all 0.2s',
    letterSpacing: '0.01em',
  },
  spinner: {
    display:       'inline-block',
    width:         15,
    height:        15,
    borderRadius:  '50%',
    border:        '2px solid #333',
    borderTop:     '2px solid #888',
    animation:     'spin 0.7s linear infinite',
  },
  errorBox: {
    background:   '#1a0a0a',
    border:       '1px solid #3a1515',
    borderRadius: 8,
    padding:      '10px 14px',
    color:        '#f87171',
    fontSize:     13,
    marginTop:    10,
  },

  results: { marginTop: 20, display: 'flex', flexDirection: 'column', gap: 10 },
  card: {
    background:   '#141414',
    border:       '1px solid #1f1f1f',
    borderRadius: 12,
    padding:      '16px 18px',
  },
  cardTitle: {
    fontSize:     14,
    fontWeight:   700,
    color:        '#e2e8f0',
    marginBottom: 14,
    display:      'flex',
    alignItems:   'baseline',
    gap:          10,
  },
  cardSub:  { fontSize: 12, color: '#555', fontWeight: 400 },

  summaryGrid: {
    display:             'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
    gap:                 8,
  },
  statCell:  { background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 8, padding: '10px 12px' },
  statLabel: { color: '#555', fontSize: 11, marginBottom: 4 },
  statValue: { fontFamily: "'Geist Mono', monospace", fontWeight: 600 },

  step: { marginBottom: 10 },
  stepHead: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 },
  stepNum: {
    width:           21,
    height:          21,
    borderRadius:    5,
    display:         'flex',
    alignItems:      'center',
    justifyContent:  'center',
    fontSize:        10.5,
    fontWeight:      800,
    color:           '#000',
    flexShrink:      0,
  },
  stepTitle: { color: '#aaa', fontSize: 12.5, fontWeight: 600 },
  stepPre: {
    background:   '#0a0a0a',
    border:       '1px solid #1a1a1a',
    borderRadius: 7,
    padding:      '12px 14px',
    margin:       0,
    color:        '#888',
    fontSize:     12,
    lineHeight:   1.8,
    fontFamily:   "'Geist Mono', 'Courier New', monospace",
    whiteSpace:   'pre-wrap',
    overflowX:    'auto',
  },

  aiToggle: {
    display:         'flex',
    justifyContent:  'space-between',
    alignItems:      'center',
    width:           '100%',
    background:      'transparent',
    border:          'none',
    color:           '#d4d4d4',
    fontSize:        13,
    fontWeight:      600,
    cursor:          'pointer',
    padding:         0,
    marginBottom:    0,
    fontFamily:      'inherit',
  },
  aiDot:    { width: 7, height: 7, borderRadius: '50%', background: '#22c55e' },
  aiChevron: { color: '#444', fontSize: 11 },
  aiText: {
    marginTop:  12,
    color:      '#888',
    fontSize:   13.5,
    lineHeight: 1.75,
    whiteSpace: 'pre-wrap',
    borderTop:  '1px solid #1a1a1a',
    paddingTop: 12,
  },
};
