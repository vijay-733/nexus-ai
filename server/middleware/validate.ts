import { Request, Response, NextFunction } from 'express';

type FieldRule = {
  type:       'string' | 'number' | 'boolean';
  required?:  boolean;
  minLen?:    number;
  maxLen?:    number;
  min?:       number;
  max?:       number;
  pattern?:   RegExp;
  oneOf?:     string[];
};

type Schema = Record<string, FieldRule>;

export function validate(schema: Schema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const errors: string[] = [];
    const body = req.body as Record<string, unknown>;

    for (const [field, rule] of Object.entries(schema)) {
      const val = body[field];
      const missing = val === undefined || val === null || val === '';

      if (rule.required && missing) {
        errors.push(`'${field}' is required`);
        continue;
      }
      if (missing) continue;

      if (rule.type === 'string') {
        if (typeof val !== 'string') { errors.push(`'${field}' must be a string`); continue; }
        if (rule.minLen  && val.length < rule.minLen)  errors.push(`'${field}' must be ≥ ${rule.minLen} characters`);
        if (rule.maxLen  && val.length > rule.maxLen)  errors.push(`'${field}' must be ≤ ${rule.maxLen} characters`);
        if (rule.pattern && !rule.pattern.test(val))   errors.push(`'${field}' has invalid format`);
        if (rule.oneOf   && !rule.oneOf.includes(val)) errors.push(`'${field}' must be one of: ${rule.oneOf.join(', ')}`);
      }

      if (rule.type === 'number') {
        const n = Number(val);
        if (isNaN(n)) { errors.push(`'${field}' must be a number`); continue; }
        if (rule.min !== undefined && n < rule.min) errors.push(`'${field}' must be ≥ ${rule.min}`);
        if (rule.max !== undefined && n > rule.max) errors.push(`'${field}' must be ≤ ${rule.max}`);
      }
    }

    if (errors.length) {
      res.status(400).json({ error: 'Validation failed', details: errors });
      return;
    }
    next();
  };
}
