import type { UserRole } from './roles';

/**
 * The identity `authenticate` extracts from a verified access token.
 * Deliberately minimal: an id and a role are all any route guard needs.
 */
export interface AuthenticatedUser {
  id: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
