'use client';

import DashboardSync from '../../components/DashboardSync';

const DashboardPage = () => {
  return (
    <div className="page-shell">
      <div className="panel">
        <h1>Session Dashboard</h1>
        <p className="subheading">
          Review first-layer session signals with raw ECG, uploaded video, and macrofactor insights.
        </p>
        <DashboardSync />
      </div>
    </div>
  );
};

export default DashboardPage;
