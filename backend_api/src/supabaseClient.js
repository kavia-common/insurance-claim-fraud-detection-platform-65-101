const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase =
  supabaseUrl && serviceRoleKey ? createClient(supabaseUrl, serviceRoleKey) : null;

/**
 * PUBLIC_INTERFACE
 * Throws a helpful error if Supabase env vars are missing.
 */
function requireSupabaseAdmin() {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured for backend. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend_api/.env'
    );
  }
  return supabase;
}

module.exports = { supabase, requireSupabaseAdmin };
