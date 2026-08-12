import { supabase } from '@/lib/supabaseClient';

/**
 * Série de HR para o gráfico da sessão — agregada NO SQL.
 *
 * Chama a RPC wearable.hr_series_bucketed (médias por bucket de N segundos), por
 * isso o que chega ao cliente são ~centenas de pontos, não os milhares de cru.
 * A hierarquia de fontes (H10 > Air, por bloco) vive em resolveHeartRateSource()
 * em metrics.ts, usada do lado do servidor pelo TRIMP; aqui, enquanto o Polar
 * H10 (training.rr_intervals) não existe, a única fonte na base é a Fitbit Air.
 *
 * Estados que o gráfico distingue:
 *   - 'ok'          → há pontos, desenha
 *   - 'arriving'    → 0 pontos mas a sessão acabou há pouco (o HR da Air é
 *                     ingerido de 3 em 3h, forward-only) → dados a chegar
 *   - 'empty'       → 0 pontos e a sessão já é antiga → não há HR
 *   - 'unavailable' → a RPC de agregação ainda não está aplicada na base
 */

export type HrPoint = { t_ms: number; bpm: number };
export type HrSource = 'air' | 'h10' | 'none';
export type HrStatus = 'ok' | 'arriving' | 'empty' | 'unavailable';

export type HrSeries = {
  status: HrStatus;
  source: HrSource;
  source_label: string | null; // ex.: "Fitbit Air"
  bucket_seconds: number;
  points: HrPoint[];
  n_raw: number; // nº de amostras cruas somadas (soma dos n dos buckets)
};

// Janela de ingestão da Air (forward-only, de 3 em 3h). Se a sessão acabou há
// menos do que isto e ainda não há pontos, é latência, não ausência.
const INGEST_LAG_MS = 3 * 60 * 60 * 1000;

type BucketRow = { bucket_start_utc: string; bpm: number; n: number; source: string };

function sourceLabel(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw.toLowerCase();
  if (s.includes('fitbit') || s.includes('google') || s.includes('air')) return 'Fitbit Air';
  if (s.includes('polar') || s.includes('h10')) return 'Polar H10';
  return raw;
}

export async function getSessionHrSeries(
  fromMs: number,
  toMs: number,
  opts?: { bucketSeconds?: number; sessionEndMs?: number | null; nowMs?: number },
): Promise<HrSeries> {
  const bucket = opts?.bucketSeconds ?? 30;
  const { data, error } = await supabase
    .schema('wearable')
    .rpc('hr_series_bucketed', {
      p_from: new Date(fromMs).toISOString(),
      p_to: new Date(toMs).toISOString(),
      p_bucket_seconds: bucket,
    });

  if (error) {
    // Função inexistente na base (migração por aplicar) → PGRST202 / 404.
    const code = (error as { code?: string }).code;
    if (code === 'PGRST202' || code === '404') {
      return { status: 'unavailable', source: 'none', source_label: null, bucket_seconds: bucket, points: [], n_raw: 0 };
    }
    throw error;
  }

  const rows = (data ?? []) as BucketRow[];
  const points: HrPoint[] = rows
    .map((r) => ({ t_ms: Date.parse(r.bucket_start_utc), bpm: Number(r.bpm) }))
    .sort((a, b) => a.t_ms - b.t_ms);
  const nRaw = rows.reduce((a, r) => a + Number(r.n ?? 0), 0);
  const rawSource = rows.length ? rows[0].source : null;

  if (points.length === 0) {
    const now = opts?.nowMs ?? Date.now();
    const end = opts?.sessionEndMs ?? toMs;
    const arriving = now - end < INGEST_LAG_MS;
    return {
      status: arriving ? 'arriving' : 'empty',
      source: 'none', source_label: null, bucket_seconds: bucket, points: [], n_raw: 0,
    };
  }

  return {
    status: 'ok',
    source: 'air', // heart_rate é Air; o ramo H10 acende quando rr_intervals existir
    source_label: sourceLabel(rawSource),
    bucket_seconds: bucket,
    points,
    n_raw: nRaw,
  };
}
