import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error('JWT_SECRET is not set in .env — server cannot start safely');

export interface TokenPayload {
  userId: string;
  email:  string;
  plan:   string;
  iat?:   number;
  exp?:   number;
}

export function signToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (jwt.sign as any)(payload, SECRET!, { expiresIn: process.env.JWT_EXPIRY ?? '7d' });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET!) as TokenPayload;
}
