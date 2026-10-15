/**
 * Client-side form checks for sign-in and account creation.
 *
 * They repeat the server's rules (docs/api/auth.md, "Identifier and password
 * rules") so mistakes show inline before anything is sent. The server still
 * validates everything.
 */

import { z } from 'zod'
import { PHONE_FORMAT_MESSAGE, isNigerianMobile } from './phone'

export const NAME_MESSAGE = 'Enter your full name.'
export const PASSWORD_LENGTH_MESSAGE = 'Use 8 to 128 characters.'
/**
 * Sign-in with an empty password. Not drawn in the design. The server's login
 * schema only requires a non-empty password of up to 128 characters, so this
 * is the only sign-in password check (length rules apply at registration).
 */
export const PASSWORD_REQUIRED_MESSAGE = 'Enter your password.'

const phone = z.string().refine(isNigerianMobile, PHONE_FORMAT_MESSAGE)

/** Sign in (C3, S1): phone format, and a password of up to 128 characters. */
export const signInSchema = z.object({
  phone,
  password: z
    .string()
    .min(1, PASSWORD_REQUIRED_MESSAGE)
    .max(128, PASSWORD_LENGTH_MESSAGE),
})

/** Create account (C2): name 1-100 after trimming, phone, password 8-128. */
export const createAccountSchema = z.object({
  name: z.string().trim().min(1, NAME_MESSAGE).max(100, NAME_MESSAGE),
  phone,
  password: z.string().min(8, PASSWORD_LENGTH_MESSAGE).max(128, PASSWORD_LENGTH_MESSAGE),
})

export type SignInValues = z.infer<typeof signInSchema>
export type CreateAccountValues = z.infer<typeof createAccountSchema>
