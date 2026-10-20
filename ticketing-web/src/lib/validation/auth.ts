import { z } from 'zod';

/** Mirrors ticketing-api src/modules/auth/dto/auth.dto.ts — the API stays the authority. */
const email = z.string().trim().min(1, 'Enter your email').max(254).pipe(z.email('Enter a valid email address'));
const password = z.string().min(10, 'Use at least 10 characters').max(128, 'Use at most 128 characters');
const name = z.string().trim().min(1, 'Enter your name').max(120);
const phone = z
  .string()
  .trim()
  .regex(/^(\+?[0-9]{7,15})?$/, 'Use 7–15 digits, optional leading +')
  .transform((value) => value || undefined);

export const loginSchema = z.object({ email, password: z.string().min(1, 'Enter your password').max(128) });
export type LoginValues = z.infer<typeof loginSchema>;

export const customerRegisterSchema = z.object({ name, email, phone, password });
export type CustomerRegisterValues = z.input<typeof customerRegisterSchema>;

export const managerRegisterSchema = z.object({
  name,
  email,
  phone,
  password,
  orgName: z.string().trim().min(2, 'Enter your organisation name').max(200),
  taxId: z
    .string()
    .trim()
    .max(32)
    .transform((value) => value || undefined),
});
export type ManagerRegisterValues = z.input<typeof managerRegisterSchema>;
