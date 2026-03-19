import React from 'react';

export default function StatusBar({ status }) {
  const isOk       = status?.status === 'ok';
  const isChecking = status?.status === 'checking';

  const color = isOk ? '#22c55e' : isChecking ? '#f59e0b' : '#ef4444';
  const label = isOk ? 'Connected' : isChecking ? 'Connecting…' : 'Offline';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{
        width:        8,
        height:       8,
        borderRadius: '50%',
        background:   color,
        boxShadow:    isOk ? `0 0 6px ${color}88` : 'none',
        transition:   'all 0.3s',
      }} />
      <span style={{ color: '#555', fontSize: 12 }}>{label}</span>
    </div>
  );
}
