import { body } from 'express-validator';

/**
 * `isString()` runs before `trim()` on purpose: sanitisers coerce their input,
 * so trimming first would silently turn `42` into `"42"` and let it pass.
 */
const emailRules = body('email')
  .exists({ values: 'falsy' })
  .withMessage('email is required')
  .bail()
  .isString()
  .withMessage('email must be a string')
  .bail()
  .trim()
  .toLowerCase()
  .isEmail()
  .withMessage('email must be a valid email address')
  .bail()
  .isLength({ max: 254 })
  .withMessage('email must be at most 254 characters');

export const registerValidator = [
  emailRules,
  body('password')
    .exists({ values: 'falsy' })
    .withMessage('password is required')
    .bail()
    .isString()
    .withMessage('password must be a string')
    .bail()
    .isLength({ min: 8, max: 128 })
    .withMessage('password must be between 8 and 128 characters')
    .bail()
    .matches(/[A-Za-z]/)
    .withMessage('password must contain at least one letter')
    .matches(/\d/)
    .withMessage('password must contain at least one number'),
];

/**
 * Login deliberately does not enforce the password policy — an existing account
 * must stay usable if the policy is tightened later, and rejecting a short
 * password here would leak that it was never a valid one.
 */
export const loginValidator = [
  emailRules,
  body('password')
    .exists({ values: 'falsy' })
    .withMessage('password is required')
    .bail()
    .isString()
    .withMessage('password must be a string'),
];
