// Shared by production Better Auth and isolated integration tests.
export const staffAuthOptions = {
  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: 12,
  },
  user: {
    additionalFields: {
      role: { type: "string", required: false, input: false, defaultValue: "staff" },
      active: { type: "boolean", required: false, input: false, defaultValue: false },
    },
  },
  session: {
    expiresIn: 60 * 60 * 8,
    updateAge: 60 * 30,
    cookieCache: { enabled: false },
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 10,
    storage: "database",
  },
} as const;
