import { type RequestHandler } from 'express';
import { validationResult } from 'express-validator';
import { HttpError, type FieldError } from '../utils/HttpError';

/**
 * Terminates a validation chain: collects whatever express-validator recorded
 * and, if anything failed, hands a single 400 to the central error handler with
 * one entry per offending field.
 *
 * Place this after the validator array on every route that has one.
 */
export const validate: RequestHandler = (req, _res, next) => {
  const result = validationResult(req);

  if (result.isEmpty()) {
    next();
    return;
  }

  const details: FieldError[] = result.array().map((error) =>
    error.type === 'field'
      ? { field: error.path, message: error.msg as string }
      : { field: 'request', message: error.msg as string },
  );

  next(HttpError.validation(details));
};
