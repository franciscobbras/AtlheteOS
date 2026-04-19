import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(request: Request) {
  const formData = await request.formData();
  const videoFile = formData.get('video');
  const ecgFile = formData.get('ecg');
  const macrofactorFile = formData.get('macrofactor');

  if (!videoFile && !ecgFile && !macrofactorFile) {
    return NextResponse.json({ error: 'At least one file must be uploaded.' }, { status: 400 });
  }

  try {
    let videoUrl: string | null = null;

    if (videoFile && videoFile instanceof File) {
      const videoBuffer = await videoFile.arrayBuffer();
      const videoName = `uploads/${Date.now()}_${videoFile.name}`;

      const { data: videoData, error: videoError } = await getSupabaseAdmin().storage
        .from('videos')
        .upload(videoName, new Uint8Array(videoBuffer), {
          contentType: videoFile.type,
        });

      if (videoError || !videoData) {
        throw videoError || new Error('Video upload failed');
      }

      videoUrl = videoData.path || null;
    }

    let ecgText: string | null = null;
    let rawValues: number[] | null = null;

    if (ecgFile && ecgFile instanceof File) {
      ecgText = await ecgFile.text();
      rawValues = ecgText
        .split(/\r?\n|,|;/)
        .map((value) => parseFloat(value.trim()))
        .filter((value) => !Number.isNaN(value));
    }

    const macrofactorText =
      macrofactorFile && macrofactorFile instanceof File
        ? await macrofactorFile.text()
        : null;

    const { error: insertError } = await getSupabaseAdmin().from('synchronized_data').insert([
      {
        video_url: videoUrl,
        ecg: rawValues || null,
        raw_data: rawValues || null,
        ecg_csv: ecgText,
        macrofactor_data: macrofactorText,
      },
    ]);

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({ message: 'Upload successful', videoUrl });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
