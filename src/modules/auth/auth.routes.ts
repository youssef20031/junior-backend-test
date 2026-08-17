import { Router } from 'express';
import { authLimiter } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import * as authController from './auth.controller';
import { loginValidator, registerValidator } from './auth.validators';

export const authRouter = Router();

/** Public. Always creates a `user`; administrators are provisioned by the seed. */
authRouter.post(
  '/register',
  authLimiter,
  registerValidator,
  validate,
  authController.register,
);

/** Public. Returns the JWT that every /products route requires. */
authRouter.post('/login', authLimiter, loginValidator, validate, authController.login);
