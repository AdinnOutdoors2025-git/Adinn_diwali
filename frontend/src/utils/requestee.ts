import { BD } from '../types';

export const normalizeRequesteeName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
export const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

export interface RequesteeCheck { name?: string; email?: string; duplicate?: BD }

// Client-side mirror of the API's rules, so mistakes and duplicates show before saving. The API still enforces them.
export function validateRequestee(name: string, email: string, existing: BD[]): RequesteeCheck {
  const cleanName = name.trim().replace(/\s+/g, ' '), cleanEmail = email.trim().toLowerCase();
  const result: RequesteeCheck = {};
  if (!cleanName) result.name = 'Requestee Name is required.';
  else if (cleanName.length > 120) result.name = 'Requestee Name must be 120 characters or fewer.';
  if (!cleanEmail) result.email = 'Email ID is required.';
  else if (!EMAIL_PATTERN.test(cleanEmail)) result.email = 'Enter a valid email address.';
  const duplicate = existing.find(bd => (!result.email && bd.email.toLowerCase() === cleanEmail) || (!result.name && normalizeRequesteeName(bd.name) === normalizeRequesteeName(cleanName)));
  if (duplicate) {
    if (duplicate.email.toLowerCase() === cleanEmail) result.email = `A Requestee with this email already exists: ${duplicate.name}.`;
    else result.name = `A Requestee named "${duplicate.name}" already exists (${duplicate.email}).`;
    result.duplicate = duplicate;
  }
  return result;
}

// Seeds the form from what was typed in the search box: an email goes to the email field, anything else to the name.
export const seedRequestee = (term: string) => term.includes('@') ? { name: '', email: term.trim() } : { name: term.trim(), email: '' };
