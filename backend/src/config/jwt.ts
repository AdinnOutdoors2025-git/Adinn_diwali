import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'adinn_diwali_jwt_super_secret_key_2026';
const JWT_EXPIRES_IN = '7d';

export interface TokenPayload {
  id: string;
  name: string;
  email: string;
  role: 'STAFF' | 'CMD';
}

export const generateToken = (payload: TokenPayload): string => {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const verifyToken = (token: string): TokenPayload => {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
};

