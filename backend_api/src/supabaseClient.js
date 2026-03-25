const { createClient } = require('@supabase/supabase-js');

/**
 * Backend should prefer server-side env vars:
 *  - SUPABASE_URL
 *  - SUPABASE_SERVICE_ROLE_KEY
 *
 * However, some deployments only provide the React-style env vars
 * (as seen in the user-provided configuration). To avoid a hard
 * configuration mismatch, we also support:
 *  - REACT_APP_SUPABASE_URL
 *  - REACT_APP_SUPABASE_ANON_KEY
 *
 * NOTE: Using the anon key server-side will only work if RLS policies
 * allow the required operations. For production backend writes, the
 * service role key is strongly recommended.
 */
const supabaseUrl = process.env.SUPABASE_URL || process.env.REACT_APP_SUPABASE_URL;

// Prefer service role for backend; fall back to anon key only if needed.
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.REACT_APP_SUPABASE_ANON_KEY;

const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

/**
 * PUBLIC_INTERFACE
 * Throws a helpful error if Supabase env vars are missing.
 */
function requireSupabaseAdmin() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured for backend. Set either (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY) ' +
        'or (REACT_APP_SUPABASE_URL and REACT_APP_SUPABASE_ANON_KEY).'
    );
  }
  return supabase;
}

module.exports = { supabase, requireSupabaseAdmin };
