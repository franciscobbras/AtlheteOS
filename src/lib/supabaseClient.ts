import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function fetchData() {
  const { data, error } = await supabase
    .from('workouts')
    .select('*');
  
  if (error) {
    console.error('Error fetching data:', error);
    return null;
  }
  
  return data;
}