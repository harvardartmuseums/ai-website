const { createHash, timingSafeEqual } = require('node:crypto');
const { isIP } = require('node:net');

function digest(value) {
  return createHash('sha256').update(value).digest();
}

// The verified path is CloudFront -> Heroku router -> Express. Both proxies
// append an address to X-Forwarded-For; ignore any viewer-supplied prefix.
function clientIp(req) {
  if (req.cloudfrontVerified) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      const addresses = forwarded.split(',').map(address => address.trim());
      const viewer = addresses[addresses.length - 2];
      const edge = addresses[addresses.length - 1];
      if (isIP(viewer || '') && isIP(edge || '')) return viewer;
    }
  }
  // Preserve trust proxy = 1 for direct traffic during the DNS transition.
  return req.ip;
}

function cloudfrontOrigin({
  mode = process.env.CLOUDFRONT_ORIGIN_MODE || 'off',
  secret = process.env.CLOUDFRONT_ORIGIN_SECRET || '',
  log = console.log,
  now = Date.now,
} = {}) {
  if (!['off', 'monitor', 'enforce'].includes(mode)) {
    throw new Error('CLOUDFRONT_ORIGIN_MODE must be off, monitor, or enforce.');
  }
  if (mode !== 'off' && (typeof secret !== 'string' || secret.length < 32)) {
    throw new Error('CLOUDFRONT_ORIGIN_SECRET must contain at least 32 characters when origin protection is enabled.');
  }
  const expected = digest(secret);
  const nextLogAt = new Map();

  return (req, res, next) => {
    const supplied = req.headers['x-origin-verify'];
    req.cloudfrontVerified = mode !== 'off' && typeof supplied === 'string'
      && timingSafeEqual(expected, digest(supplied));
    req.clientIp = clientIp(req);

    if (mode !== 'off') {
      const outcome = req.cloudfrontVerified ? 'verified' : 'unverified';
      const time = now();
      // At most two messages per minute per process, even under heavy abuse.
      if (!nextLogAt.has(outcome) || time >= nextLogAt.get(outcome)) {
        nextLogAt.set(outcome, time + 60000);
        log(`CloudFront origin: ${outcome}; mode=${mode}`);
      }
    }

    if (mode === 'enforce' && !req.cloudfrontVerified) {
      res.set('Cache-Control', 'no-store');
      return res.status(403).send('Forbidden');
    }
    next();
  };
}

module.exports = { cloudfrontOrigin, clientIp };
