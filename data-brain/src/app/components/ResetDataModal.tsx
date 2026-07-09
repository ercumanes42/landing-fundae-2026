'use client';
import React, { useState } from 'react';

export default function ResetDataModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [confirmText, setConfirmText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleReset = async () => {
    if (confirmText !== 'RESET') return;
    setIsLoading(true);
    try {
      // In a real implementation this would call an API endpoint to create a new campaign
      // and set it as active, virtually "resetting" the dashboard view.
      await new Promise(r => setTimeout(r, 1500)); 
      setSuccess(true);
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } catch (e) {
      console.error(e);
      setIsLoading(false);
    }
  };

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        style={{
          background: 'rgba(255, 45, 155, 0.1)',
          border: '1px solid var(--magenta)',
          color: 'var(--magenta)',
          padding: '8px 16px',
          borderRadius: '8px',
          cursor: 'pointer',
          fontWeight: 700,
          textTransform: 'uppercase',
          fontSize: '11px',
          letterSpacing: '0.05em'
        }}
      >
        🗑 Nueva Campaña (Reset)
      </button>

      {isOpen && (
        <div style={{
          position: 'fixed',
          top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.8)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 9999
        }}>
          <div style={{
            background: 'var(--bg-2)',
            border: '1px solid var(--magenta)',
            boxShadow: '0 0 30px rgba(255,45,155,0.2)',
            padding: '30px',
            borderRadius: '16px',
            maxWidth: '400px',
            width: '90%',
            textAlign: 'center'
          }}>
            {success ? (
              <div>
                <div style={{ fontSize: '40px', marginBottom: '16px' }}>✅</div>
                <h2 style={{ margin: '0 0 10px', color: 'var(--text)' }}>Campaña Iniciada</h2>
                <p style={{ color: 'var(--muted)', fontSize: '13px' }}>El dashboard se recargará ahora.</p>
              </div>
            ) : (
              <>
                <h2 style={{ margin: '0 0 15px', color: 'var(--text)', fontSize: '18px' }}>⚠️ Iniciar Nueva Campaña</h2>
                <p style={{ color: 'var(--muted)', fontSize: '13px', marginBottom: '20px', lineHeight: 1.5 }}>
                  Estás a punto de iniciar una nueva campaña. Los datos actuales quedarán guardados en el histórico pero desaparecerán del panel actual para comenzar desde cero.
                </p>
                <div style={{ marginBottom: '20px' }}>
                  <label style={{ display: 'block', fontSize: '11px', color: 'var(--muted)', marginBottom: '8px', textAlign: 'left', fontWeight: 'bold' }}>
                    ESCRIBE "RESET" PARA CONFIRMAR:
                  </label>
                  <input 
                    type="text" 
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder="RESET"
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      background: 'rgba(0,0,0,0.4)',
                      border: '1px solid var(--line)',
                      borderRadius: '8px',
                      color: 'var(--text)',
                      fontSize: '14px',
                      textAlign: 'center',
                      outline: 'none',
                      textTransform: 'uppercase'
                    }}
                  />
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  <button 
                    onClick={() => setIsOpen(false)}
                    style={{
                      flex: 1,
                      background: 'transparent',
                      border: '1px solid var(--line)',
                      color: 'var(--muted)',
                      padding: '12px',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      fontWeight: 600
                    }}
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={handleReset}
                    disabled={confirmText !== 'RESET' || isLoading}
                    style={{
                      flex: 1,
                      background: confirmText === 'RESET' ? 'var(--magenta)' : 'var(--panel)',
                      border: 'none',
                      color: confirmText === 'RESET' ? '#fff' : 'var(--muted)',
                      padding: '12px',
                      borderRadius: '8px',
                      cursor: confirmText === 'RESET' ? 'pointer' : 'not-allowed',
                      fontWeight: 700,
                      opacity: isLoading ? 0.7 : 1
                    }}
                  >
                    {isLoading ? 'Procesando...' : 'Confirmar Reset'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
