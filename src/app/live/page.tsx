import PolarH10Connect from '../../components/PolarH10Connect';
import H10SessionPanel from '../../components/H10SessionPanel';

const LivePage = () => {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="page-header">
        <h1 className="page-title">Live Session</h1>
        <p className="page-subtitle">
          Connect your Polar H10 over Bluetooth to stream real-time ECG and heart rate.
        </p>
      </div>

      <div className="card">
        <p className="section-label">Polar H10 Connection</p>
        <PolarH10Connect />
      </div>

      <div className="card">
        <p className="section-label">Data Streaming</p>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 16px' }}>
          Forward HR, RR intervals, and raw ECG to a WebSocket server in real time.
        </p>
        <H10SessionPanel />
      </div>
    </div>
  );
};

export default LivePage;
