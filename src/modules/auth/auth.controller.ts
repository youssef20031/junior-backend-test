import { type RequestHandler } from 'express';
import { matchedData } from 'express-validator';
import * as authService from './auth.service';
import { type Credentials } from './auth.service';

/**
 * `matchedData` returns only the fields that had a validator attached, so
 * anything extra a client sends — `role`, `_id` — is discarded here rather than
 * being trusted downstream.
 */
function readCredentials(req: Parameters<RequestHandler>[0]): Credentials {
  const { email, password } = matchedData<Credentials>(req, { locations: ['body'] });
  return { email, password };
}

export const register: RequestHandler = async (req, res) => {
  const result = await authService.registerUser(readCredentials(req));
  res.status(201).json({ success: true, data: result });
};

export const login: RequestHandler = async (req, res) => {
  const result = await authService.loginUser(readCredentials(req));
  res.status(200).json({ success: true, data: result });
};
