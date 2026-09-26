export function securityHeaders(html) {
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1];
  if (!csp || csp.includes('unsafe-inline') || csp.includes('unsafe-eval')) throw Error('Missing strict CSP');
  return { 'Content-Security-Policy': csp + "; frame-ancestors 'none'", 'X-Frame-Options':'DENY',
    'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'no-referrer',
    'Permissions-Policy':'camera=(), microphone=(), geolocation=(), payment=()',
    'Strict-Transport-Security':'max-age=31536000' };
}
