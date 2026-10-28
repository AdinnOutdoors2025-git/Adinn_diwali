import { Client, IClient } from '../models/Client.js';

export const normalizeName = (name: string): string => {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
};

export const normalizeMobile = (mobile: string): string => {
  const digits = mobile.replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) {
    return digits.slice(-10);
  }
  return digits;
};

// New and changed phone numbers: exactly 10 digits, nothing else (no +91, spaces or dashes).
export const PHONE_MESSAGE = 'Phone number must be exactly 10 digits (numbers only)';
export const isTenDigitMobile = (mobile: string): boolean => /^\d{10}$/.test(mobile.trim());

// Lenient legacy check, only used for records saved before the 10-digit rule.
export const isValidMobile = (mobile: string): boolean => {
  const digits = mobile.replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 15 && /^[+\d\s().-]+$/.test(mobile);
};

/**
 * Finds an existing client by normalized mobile and name, or creates a new client identity.
 * Reuses the master identity if the client already exists in the system.
 */
export const findOrCreateClient = async (data: {
  name: string;
  mobile: string;
  email?: string;
}): Promise<{ client: IClient; isNew: boolean }> => {
  const trimmedName = data.name.trim();
  const trimmedMobile = data.mobile.trim();
  const trimmedEmail = data.email ? data.email.trim().toLowerCase() : '';

  const normName = normalizeName(trimmedName);
  const normMobile = normalizeMobile(trimmedMobile);

  // Look up existing client by normalized mobile (and/or normalized name)
  let existingClient: IClient | null = null;

  if (normMobile) {
    existingClient = await Client.findOne({ normalizedMobile: normMobile });
  }

  if (!existingClient && normName) {
    existingClient = await Client.findOne({ normalizedName: normName });
  }

  if (existingClient) {
    // If email is provided and existing didn't have one, update it
    if (trimmedEmail && !existingClient.email) {
      existingClient.email = trimmedEmail;
      await existingClient.save();
    }
    return { client: existingClient, isNew: false };
  }

  try {
    const newClient = await Client.create({
    name: trimmedName,
    normalizedName: normName,
    mobile: trimmedMobile,
    normalizedMobile: normMobile,
    email: trimmedEmail,
    });

    return { client: newClient, isNew: true };
  } catch (error: any) {
    if (error.code !== 11000) throw error;
    // A concurrent request may have just created the same identity under another association.
    const winner = await Client.findOne({ normalizedMobile: normMobile }) || await Client.findOne({ normalizedName: normName });
    if (!winner) throw error;
    return { client: winner, isNew: false };
  }
};

