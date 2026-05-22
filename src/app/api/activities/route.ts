import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET() {
  const { data, error } = await getSupabaseAdmin()
    .from('activities')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { title, type, duration_seconds, notes, ecg, heart_rate_avg, heart_rate_max, video_url, source } = body;

  if (!title?.trim()) {
    return NextResponse.json({ error: 'Title is required.' }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from('activities')
    .insert([{ title, type, duration_seconds, notes, ecg, heart_rate_avg, heart_rate_max, video_url, source }])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
