'use client';

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
import zoomPlugin from 'chartjs-plugin-zoom';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  zoomPlugin
);

interface DetailedECGChartProps {
  ecgData: number[];
  labels: string[];
  startLabel?: string | null;
}

const DetailedECGChart: React.FC<DetailedECGChartProps> = ({ ecgData, labels, startLabel }) => {
  const data = {
    labels,
    datasets: [
      {
        label: 'ECG Data',
        data: ecgData,
        borderColor: 'rgba(59, 147, 255, 1)',
        backgroundColor: 'rgba(59, 147, 255, 0.24)',
        fill: true,
      },
    ],
  };

  const options: any = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: startLabel
          ? `ECG Detail • ${startLabel}`
          : 'ECG Detail',
        color: '#f8fcff',
      },
      zoom: {
        zoom: {
          wheel: {
            enabled: true,
          },
          pinch: {
            enabled: true,
          },
          mode: 'x',
        },
        pan: {
          enabled: true,
          mode: 'x',
        },
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
          maxTicksLimit: 12,
        },
      },
      y: {
        min: -1400,
        max: 1400,
        title: {
          display: true,
          text: 'ECG (µV)',
          color: '#c7d4f6',
        },
        ticks: {
          color: '#aab8d6',
        },
      },
    },
  };

  return (
    <div className="detail-chart-panel" style={{ height: 450 }}>
      <Line data={data} options={options} />
      <p className="chart-hint">
        Scroll to zoom, pinch to zoom on touch, and drag to explore the ECG trace.
      </p>
    </div>
  );
};

export default DetailedECGChart;
