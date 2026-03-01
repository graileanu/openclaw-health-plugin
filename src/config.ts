export interface HealthConfig {
  supabaseUrl: string;
  supabaseKey: string;
  userId: string;
}

export function parseConfig(): HealthConfig | null {
  const supabaseUrl = process.env.HEALTH_SUPABASE_URL;
  const supabaseKey = process.env.HEALTH_SUPABASE_KEY;
  const userId = process.env.HEALTH_USER_ID;

  if (!supabaseUrl || !supabaseKey || !userId) {
    return null;
  }

  return { supabaseUrl, supabaseKey, userId };
}
