/** Shared, pure input validation for onboarding and invitations. */

export const EMAIL_MAX_LENGTH = 254;
export const TENANT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])?$/;
export const TENANT_NAME_MAX_LENGTH = 120;
export const FULL_NAME_MAX_LENGTH = 120;

export function isValidEmail(value: string): boolean {
  const email = value.trim();
  return (
    email.length > 0 &&
    email.length <= EMAIL_MAX_LENGTH &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  );
}

export function isValidTenantSlug(value: string): boolean {
  const slug = value.trim();
  return slug.length >= 3 && slug.length <= 40 && TENANT_SLUG_PATTERN.test(slug);
}

export function isValidTenantName(value: string): boolean {
  const name = value.trim();
  return name.length >= 2 && name.length <= TENANT_NAME_MAX_LENGTH;
}

export function isValidFullName(value: string): boolean {
  const name = value.trim();
  return name.length >= 2 && name.length <= FULL_NAME_MAX_LENGTH;
}
