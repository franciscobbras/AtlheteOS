import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend);

interface PolarECGChartProps {
  ecgData: number[];
  labels?: string[];
}

const PolarECGChart: React.FC<PolarECGChartProps> = ({ ecgData, labels }) => {
  const data = {
    labels: labels || ecgData.map((_, index) => index.toString()),
    datasets: [
      {
        label: 'ECG Data',
        data: ecgData,
        borderColor: 'rgba(75, 192, 192, 1)',
        backgroundColor: 'rgba(75, 192, 192, 0.2)',
        fill: true,
      },
    ],
  };

  const options = {
    responsive: true,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: 'ECG Trace',
        color: '#f8fcff',
      },
    },
    scales: {
      x: {
        title: {
          display: true,
          text: 'Time',
          color: '#c7d4f6',
        },
        ticks: {
          color: '#aab8d6',
          maxRotation: 0,
          autoSkip: true,
          maxTicksLimit: 10,
        },
      },
      y: {
        title: {
          display: true,
          text: 'ECG Value',
          color: '#c7d4f6',
        },
        ticks: {
          color: '#aab8d6',
        },
      },
    },
  };

  return <Line data={data} options={options} />;
};

export default PolarECGChart;
