import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabase =
  supabaseUrl && supabaseAnonKey
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export async function testConnection() {
  if (!supabase) return []
  const { data, error } = await supabase.from("developers").select("*");
  console.log("TEST developers:", data, error);
  if (error) throw error;
  return data ?? [];
}

