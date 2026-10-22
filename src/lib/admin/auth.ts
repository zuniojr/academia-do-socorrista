import crypto from 'node:crypto';

const COOKIE_NAME = 'as_admin_session';
const SESSION_TTL_SECONDS = 86400; // 24 horas

// Armazenamento em memória para proteção contra força bruta (Rate Limiting)
interface AttemptRecord {
  count: number;
  lockedUntil: number;
}
const loginAttempts = new Map<string, AttemptRecord>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 900; // 15 minutos

export function checkLoginRateLimit(clientIp: string): { allowed: boolean; remainingSeconds?: number } {
  const now = Date.now();
  const record = loginAttempts.get(clientIp);

  if (!record) {
    return { allowed: true };
  }

  if (record.lockedUntil > now) {
    const remainingSeconds = Math.ceil((record.lockedUntil - now) / 1000);
    return { allowed: false, remainingSeconds };
  }

  // Se o tempo de bloqueio expirou, reseta o registro
  if (record.lockedUntil > 0 && record.lockedUntil <= now) {
    loginAttempts.delete(clientIp);
  }

  return { allowed: true };
}

export function recordFailedLoginAttempt(clientIp: string): { remainingAttempts: number; isLocked: boolean } {
  const now = Date.now();
  const record = loginAttempts.get(clientIp) || { count: 0, lockedUntil: 0 };

  record.count += 1;

  if (record.count >= MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_SECONDS * 1000;
    loginAttempts.set(clientIp, record);
    return { remainingAttempts: 0, isLocked: true };
  }

  loginAttempts.set(clientIp, record);
  return { remainingAttempts: MAX_ATTEMPTS - record.count, isLocked: false };
}

export function resetLoginAttempts(clientIp: string): void {
  loginAttempts.delete(clientIp);
}

function getSessionSecret(): string | null {
  const secret = process.env.SESSION_SECRET;
  const isProd = process.env.NODE_ENV === 'production';

  if (!secret) {
    if (isProd) {
      // Em produção, nunca utiliza segredo padrão
      return null;
    }
    return 'dev-local-session-secret-change-in-production-32-chars';
  }

  if (isProd && secret.length < 32) {
    // Segredo fraco em produção é recusado
    return null;
  }

  return secret;
}

export function getAdminPassword(): string | null {
  const pass = process.env.ADMIN_PASSWORD;
  const isProd = process.env.NODE_ENV === 'production';

  if (!pass) {
    if (isProd) {
      // Em produção, credencial padrão é estritamente proibida
      return null;
    }
    return 'admin123';
  }

  if (isProd && pass === 'admin123') {
    // Rejeita explicitamente o uso da senha de exemplo em produção
    return null;
  }

  return pass;
}

/**
 * Comparação em tempo constante (timing-safe) para evitar ataques de timing na senha.
 * Se a configuração de produção for inválida ou ausente, recusa de forma segura.
 */
export function verifyAdminPassword(inputPassword: string): boolean {
  if (!inputPassword || typeof inputPassword !== 'string') return false;

  const configuredPassword = getAdminPassword();
  if (!configuredPassword) {
    // Credencial ausente ou insegura: recusa login imediatamente
    return false;
  }

  const inputBuffer = Buffer.from(inputPassword);
  const configuredBuffer = Buffer.from(configuredPassword);

  if (inputBuffer.length !== configuredBuffer.length) {
    // Comparação dummy para manter tempo constante
    crypto.timingSafeEqual(configuredBuffer, configuredBuffer);
    return false;
  }

  return crypto.timingSafeEqual(inputBuffer, configuredBuffer);
}

/**
 * Criação de token de sessão assinado com HMAC-SHA256
 */
export function createSessionToken(): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;

  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = JSON.stringify({
    role: 'admin',
    exp: expiresAt,
  });

  const encodedPayload = Buffer.from(payload).toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
}

/**
 * Validação de token de sessão
 */
export function validateSessionToken(token: string | undefined | null): boolean {
  if (!token || typeof token !== 'string') return false;

  const parts = token.split('.');
  if (parts.length !== 2) return false;

  const [encodedPayload, providedSignature] = parts;
  const secret = getSessionSecret();
  if (!secret) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload)
    .digest('base64url');

  const providedBuffer = Buffer.from(providedSignature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  if (!crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    return false;
  }

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (!payload.exp || typeof payload.exp !== 'number') {
      return false;
    }
    if (Date.now() > payload.exp) {
      return false;
    }
    return payload.role === 'admin';
  } catch {
    return false;
  }
}

/**
 * Extrai cookies do cabeçalho da requisição
 */
export function parseCookies(cookieHeader: string | null): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;

  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const name = parts[0]?.trim();
    if (!name) return;
    const val = parts.slice(1).join('=').trim();
    list[name] = decodeURIComponent(val);
  });

  return list;
}

/**
 * Valida se a requisição HTTP contém uma sessão administrativa ativa e legítima
 */
export function isRequestAuthenticated(request: Request): boolean {
  const cookieHeader = request.headers.get('cookie');
  const cookies = parseCookies(cookieHeader);
  const token = cookies[COOKIE_NAME];
  return validateSessionToken(token);
}

/**
 * Constrói o cabeçalho Set-Cookie para autenticar a sessão
 */
export function buildAuthCookie(token: string, isSecure = process.env.NODE_ENV === 'production'): string {
  const secureFlag = isSecure ? '; Secure' : '';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL_SECONDS}${secureFlag}`;
}

/**
 * Constrói o cabeçalho Set-Cookie para expirar e deslogar a sessão
 */
export function buildClearAuthCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}
