import H10SessionPanel from '../../components/H10SessionPanel';

const LivePage = () => {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="page-header">
        <h1 className="page-title">Live Session</h1>
        <p className="page-subtitle">
          Connect your Polar H10 over Bluetooth to stream and record real-time ECG and heart rate.
        </p>
      </div>

      <div className="card">
        <p className="section-label">Polar H10</p>
        <H10SessionPanel />
      </div>
    </div>
  );
};

export default LivePage;
