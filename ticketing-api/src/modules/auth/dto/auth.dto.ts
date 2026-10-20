import { z } from 'zod';

const email = z
  .email()
  .max(254)
  .transform((value) => value.trim().toLowerCase());
const password = z.string().min(10, 'must be at least 10 characters').max(128);
const name = z.string().trim().min(1).max(120);
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{7,15}$/, 'must be 7–15 digits, optional leading +')
  .optional();

export const PortalSchema = z.enum(['customer', 'manager', 'admin']);
export type Portal = z.infer<typeof PortalSchema>;

export const RegisterCustomerSchema = z.object({ email, password, name, phone }).strict();
export type RegisterCustomer = z.infer<typeof RegisterCustomerSchema>;

export const RegisterManagerSchema = z
  .object({
    email,
    password,
    name,
    phone,
    orgName: z.string().trim().min(2).max(200),
    taxId: z.string().trim().max(32).optional(),
  })
  .strict();
export type RegisterManager = z.infer<typeof RegisterManagerSchema>;

export const LoginSchema = z.object({ email, password: z.string().min(1).max(128) }).strict();
export type Login = z.infer<typeof LoginSchema>;

export const PublicUserSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(['CUSTOMER', 'MANAGER', 'ADMIN']),
  status: z.enum(['ACTIVE', 'PENDING_VERIFICATION', 'SUSPENDED']),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const AuthResponseSchema = z.object({
  accessToken: z.string(),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int(),
  user: PublicUserSchema,
});
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
