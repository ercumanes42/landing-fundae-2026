const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'Content-Type': 'text/html; charset=utf-8',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
};

function layout(title: string, content: string): string {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} | GFS Consulting Group</title><style>
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#19163b;background:#f6f5fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at top,#fff 0,#f6f5fb 52%,#edeaf8 100%)}main{width:min(100%,560px);background:#fff;border:1px solid #ddd8ef;border-radius:24px;padding:clamp(28px,6vw,48px);box-shadow:0 24px 70px rgba(48,43,123,.14)}.brand{font-weight:800;letter-spacing:-.02em;color:#302b7b}.brand span{color:#ff206e}h1{font-size:clamp(28px,5vw,40px);line-height:1.08;margin:28px 0 16px;color:#171431}p{font-size:17px;line-height:1.6;color:#55506f;margin:0 0 24px}button{width:100%;border:0;border-radius:12px;padding:15px 20px;background:#302b7b;color:#fff;font:700 16px/1.2 inherit;cursor:pointer;box-shadow:0 10px 25px rgba(48,43,123,.2)}button:hover{background:#24205f}button:focus-visible{outline:3px solid #ff206e;outline-offset:3px}.note{font-size:14px;margin:18px 0 0;color:#6f6a84}.check{display:grid;place-items:center;width:54px;height:54px;border-radius:50%;background:#fce8f1;color:#ba0d5b;font-size:28px;font-weight:900}</style></head>
<body><main>${content}</main></body></html>`;
}

export function unsubscribeSecurityHeaders(extra?: Record<string, string>): HeadersInit {
  return { ...SECURITY_HEADERS, ...extra };
}

export function renderUnsubscribeConfirmation(token: string): string {
  const safeToken = /^u1\.[A-Za-z0-9_-]{43}$/.test(token) ? token : '';
  return layout('Confirmar baja', `<div class="brand">gfs<span>consulting</span></div>
  <h1>&iquest;Quieres dejar de recibir comunicaciones comerciales?</h1>
  <p>Confirma la baja y bloquearemos las comunicaciones comerciales futuras asociadas a tu direcci&oacute;n.</p>
  <form method="post" action="/baja"><input type="hidden" name="token" value="${safeToken}"><button type="submit">Confirmar baja</button></form>
  <p class="note">La solicitud es gratuita y se aplica de forma inmediata en nuestro sistema.</p>`);
}

export function renderUnsubscribeCompleted(): string {
  return layout('Solicitud recibida', `<div class="brand">gfs<span>consulting</span></div>
  <div class="check" aria-hidden="true">&#10003;</div><h1>Solicitud recibida</h1>
  <p>Hemos recibido la solicitud. Si el enlace era v&aacute;lido, la baja de comunicaciones comerciales ha quedado aplicada.</p>
  <p class="note">Si necesitas confirmaci&oacute;n, escribe a administracion@gfs.es.</p>`);
}

export function renderUnsubscribeRetry(): string {
  return layout('Intentalo de nuevo', `<div class="brand">gfs<span>consulting</span></div>
  <h1>No hemos podido completar la solicitud</h1>
  <p>El servicio no est&aacute; disponible temporalmente. Conserva este enlace e int&eacute;ntalo de nuevo en unos minutos.</p>`);
}
