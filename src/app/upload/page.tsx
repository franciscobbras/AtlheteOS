import UploadForm from '../../components/UploadForm';

const UploadPage = () => {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div className="page-header">
        <h1 className="page-title">Upload Session Data</h1>
        <p className="page-subtitle">
          Upload raw session files — ECG, Macrofactor export, or video — directly to your dashboard.
          To log a structured activity, use the Activities page instead.
        </p>
      </div>

      <div className="card">
        <UploadForm />
      </div>
    </div>
  );
};

export default UploadPage;
