// Enkel in-memory rate limiter (sliding window). Ingen extern tjänst.
//
// OBS: state lever per serverless-instans (Vercel kan spinna upp flera
// instanser eller återanvända kalla instanser), så detta är "best effort" —
// inte en garanterad global gräns. Accepterat för detta scope.

const hits = new Map<string, number[]>();

export const getClientIp = (headers?: Record<string, string | string[] | undefined>): string => {
  const forwarded = headers?.['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (!value) return 'unknown';
  return value.split(',')[0].trim() || 'unknown';
};

export const isRateLimited = (key: string, maxRequests: number, windowMs: number): boolean => {
  const now = Date.now();
  const windowStart = now - windowMs;
  const timestamps = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (timestamps.length >= maxRequests) {
    hits.set(key, timestamps);
    return true;
  }

  timestamps.push(now);
  hits.set(key, timestamps);
  return false;
};
