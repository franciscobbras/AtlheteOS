import UploadForm from '../../components/UploadForm';

const UploadPage = () => {
  return (
    <div className="page-shell">
      <div className="panel">
        <h1>Upload your training session</h1>
        <p className="subheading">
          Add a video recording, Polar ECG export, and macrofactor metrics to start
          reviewing your first layer of session data.
        </p>
        <UploadForm />
      </div>
    </div>
  );
};

export default UploadPage;
