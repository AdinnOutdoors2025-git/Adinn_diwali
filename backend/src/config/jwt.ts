import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

const JWT_EXPIRES_IN = '7d';
const MIN_SECRET_LENGTH = 32;

// Values that were published in the repository or are placeholders. Never acceptable in production.
const KNOWN_INSECURE = [
  'adinn_diwali_jwt_super_secret_key_2026',
  'changeme', 'secret', 'jwt_secret', 'your_jwt_secret', 'replace_me',
];

const isProduction = (): boolean => process.env.NODE_ENV === 'production';

/** Returns why the configured secret is unacceptable, or null when it is fine. */
export const jwtSecretProblem = (secret: string | undefined): string | null => {
  const value = (secret ?? '').trim();
  if (!value) return 'JWT_SECRET is not set.';
  if (value.length < MIN_SECRET_LENGTH) return `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters.`;
  const lower = value.toLowerCase();
  if (KNOWN_INSECURE.includes(lower) || lower.startsWith('replace_with') || lower.startsWith('<')) {
    return 'JWT_SECRET is a placeholder or a value that was published in the repository.';
  }
  return null;
};

/** Call once at startup, after dotenv has loaded. Throws in production when the secret is missing or insecure. */
export const assertJwtConfig = (): void => {
  const problem = jwtSecretProblem(process.env.JWT_SECRET);
  if (problem && isProduction()) {
    throw new Error(`${problem} Set a strong random JWT_SECRET in the production environment (for example: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))").`);
  }
};

// Development only: with no usable secret, use a random one for this process. Tokens stop working after a restart,
// but there is never a predictable secret.
let ephemeralSecret: string | null = null;

// Read lazily: this module can be evaluated before dotenv has loaded backend/.env.
const getSecret = (): string => {
  const configured = process.env.JWT_SECRET?.trim();
  if (isProduction()) {
    const problem = jwtSecretProblem(configured);
    if (problem) throw new Error(problem);
    return configured!;
  }
  if (configured) return configured;
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(48).toString('base64url');
    console.warn('[Auth] JWT_SECRET is not set. Using a temporary random secret; logins will not survive a restart.');
  }
  return ephemeralSecret;
};

export interface TokenPayload {
  id: string;
  name: string;
  email: string;
  role: 'STAFF' | 'CMD';
}

export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, getSecret(), { expiresIn: JWT_EXPIRES_IN });
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, getSecret()) as TokenPayload;
};
