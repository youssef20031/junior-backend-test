/**
 * The single source of truth for user roles.
 *
 * Kept in its own module so the User model, the JWT helpers, and the
 * authorization middleware can all share it without importing each other.
 */
export const USER_ROLES = ['user', 'admin'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}
