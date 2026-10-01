// Supabase project connection info.
// The "anon" key is meant to be public/embedded in client code - it is NOT a secret.
// Real security comes from Row Level Security policies (see schema.sql), which require
// a signed-in user before any read/write succeeds.
export const SUPABASE_URL = "REPLACE_WITH_PROJECT_URL";
export const SUPABASE_ANON_KEY = "REPLACE_WITH_ANON_PUBLIC_KEY";
