// SSRF-skydd för server-side fetchar mot klient-angivna URL:er.

export const isHttpUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

const isPrivateOrLinkLocalIPv4 = (hostname: string): boolean => {
  const match = hostname.match(IPV4_PATTERN);
  if (!match) return false;
  const [, a, b] = match;
  const first = Number(a);
  const second = Number(b);
  if (first === 127) return true; // loopback
  if (first === 10) return true; // 10.0.0.0/8
  if (first === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12
  if (first === 192 && second === 168) return true; // 192.168.0.0/16
  if (first === 169 && second === 254) return true; // 169.254.0.0/16 (link-local, incl. cloud metadata)
  return false;
};

const isIPv6Literal = (hostname: string): boolean => {
  // Bracketed ([::1]) forms have already had brackets stripped by URL.hostname.
  return hostname.includes(':');
};

export const isBlockedHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().trim();
  if (!host) return true;
  if (host === 'localhost') return true;
  if (host.endsWith('.local')) return true;
  if (host.endsWith('.internal')) return true;
  if (isPrivateOrLinkLocalIPv4(host)) return true;
  if (isIPv6Literal(host)) return true; // blocks ::1 and all other IPv6 literals
  return false;
};

const TRUSTED_STORE_DOMAINS = [
  'bygghemma.se',
  'hornbach.se',
  'hornbach.com',
  'bauhaus.se',
  'bauhaus.com',
  'bau1.com',
  'clasohlson.com',
  'clas-ohlson.com',
  'byggmax.se',
  'maxbo.se',
  'kahrs.com',
  'pergo.com',
  'tarkett.com',
  'boen.com',
  'bricmate.se',
  'ellos.se',
  'golvlageret.se',
];

export const isTrustedStoreHost = (hostname: string): boolean => {
  const host = hostname.toLowerCase().trim();
  return TRUSTED_STORE_DOMAINS.some((d) => host === d || host.endsWith('.' + d));
};
