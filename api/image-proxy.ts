
interface ApiRequest {
  method?: string;
  query?: Record<string, string | string[]>;
}

interface ApiResponse {
  status: (statusCode: number) => ApiResponseWithBody;
  setHeader: (name: string, value: string) => void;
  end: (data?: Buffer | string) => void;
}

interface ApiResponseWithBody {
  json: (payload: unknown) => void;
  end: (data?: Buffer | string) => void;
}

const ALLOWED_HOSTS = [
  // bygghemma
  'cdn.bygghemma.se', 'www.bygghemma.se', 'bygghemma.se', 'img.bygghemma.se',
  // hornbach
  'images.hornbach.com', 'www.hornbach.se', 'hornbach.se', 'static.hornbach.com', 'media.hornbach.se',
  // bauhaus
  'media.bauhaus.se', 'www.bauhaus.se', 'bauhaus.se', 'media.bau1.com', 'cdn.bauhaus.se', 'www.bauhaus.com',
  // clas ohlson
  'cdn.clas-ohlson.com', 'www.clasohlson.com', 'clasohlson.com',
  // byggmax
  'media.byggmax.se', 'www.byggmax.se', 'byggmax.se', 'cdn.byggmax.se',
  // maxbo
  'images.maxbo.se', 'www.maxbo.se', 'maxbo.se',
  // kährs
  'www.kahrs.com', 'kahrs.com', 'cdn.kahrs.com',
  // pergo
  'www.pergo.com', 'cdn.pergo.com',
  // tarkett
  'www.tarkett.com', 'cdn.tarkett.com',
  // boen
  'www.boen.com', 'cdn.boen.com',
  // bricmate
  'www.bricmate.se', 'cdn.bricmate.se',
  // ellos / home
  'img.ellos.se', 'www.ellos.se',
  // golvlageret
  'golvlageret.se', 'www.golvlageret.se',
  // generic image CDNs used by many Swedish retailers
  'images.ctfassets.net', 'cdn.shopify.com', 'i.imgur.com',
];

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const rawUrl = req.query?.url;
  const imageUrl = typeof rawUrl === 'string' ? rawUrl : Array.isArray(rawUrl) ? rawUrl[0] : null;

  if (!imageUrl) {
    return res.status(400).json({ error: 'Missing url parameter' });
  }

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return res.status(400).json({ error: 'Invalid URL protocol' });
  }

  if (!ALLOWED_HOSTS.includes(parsed.hostname)) {
    return res.status(403).json({ error: 'Host not allowed' });
  }

  try {
    const upstream = await fetch(imageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ProFloor/1.0)',
        'Referer': `${parsed.protocol}//${parsed.hostname}/`,
        'Accept': 'image/*,*/*',
      },
      redirect: 'follow',
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'Upstream fetch failed' });
    }

    const contentType = upstream.headers.get('content-type') ?? 'image/jpeg';
    if (!contentType.startsWith('image/')) {
      return res.status(400).json({ error: 'URL is not an image' });
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.end(buffer);
  } catch {
    return res.status(502).json({ error: 'Failed to fetch image' });
  }
}
