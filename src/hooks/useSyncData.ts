import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const useSyncData = (videoId: string | null) => {
    const [ecgData, setEcgData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            try {
                const { data, error } = await supabase
                    .from('ecg_data')
                    .select('*')
                    .eq('video_id', videoId);

                if (error) throw error;

                setEcgData(data);
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setLoading(false);
            }
        };

        if (videoId) {
            fetchData();
        }
    }, [videoId]);

    return { ecgData, loading, error };
};

export default useSyncData;
