import { useState, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';
import { getTripHistory, exportTripsToCSV, type TripRecord } from '../utils/storage';
import { formatDistance, formatEnergy, formatDuration } from '../utils/format';

Chart.register(...registerables);

type DateRange = 'this_month' | 'last_month' | 'last_3_months' | 'all';
type SortKey = 'date' | 'distance' | 'efficiency';
type SortDir = 'asc' | 'desc';

function getDateRangeStart(range: DateRange): number {
  const now = new Date();
  switch (range) {
    case 'this_month':
      return new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
    case 'last_month':
      return new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime() / 1000;
    case 'last_3_months':
      return new Date(now.getFullYear(), now.getMonth() - 2, 1).getTime() / 1000;
    case 'all':
      return 0;
  }
}

function getDateRangeEnd(range: DateRange): number {
  if (range === 'last_month') {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
  }
  return Infinity;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function TripHistory() {
  const [dateRange, setDateRange] = useState<DateRange>('this_month');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const allTrips = useMemo(() => getTripHistory(), []);

  const filteredTrips = useMemo(() => {
    const start = getDateRangeStart(dateRange);
    const end = getDateRangeEnd(dateRange);
    return allTrips.filter((t) => t.startTime >= start && t.startTime < end);
  }, [allTrips, dateRange]);

  const sortedTrips = useMemo(() => {
    const sorted = [...filteredTrips];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'date':
          cmp = a.startTime - b.startTime;
          break;
        case 'distance':
          cmp = a.distance - b.distance;
          break;
        case 'efficiency':
          cmp = a.efficiency - b.efficiency;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [filteredTrips, sortKey, sortDir]);

  const stats = useMemo(() => {
    const totalTrips = filteredTrips.length;
    const totalDistance = filteredTrips.reduce((sum, t) => sum + t.distance, 0);
    const totalEnergy = filteredTrips.reduce((sum, t) => sum + t.energyUsed, 0);
    const avgEfficiency =
      totalTrips > 0
        ? filteredTrips.reduce((sum, t) => sum + t.efficiency, 0) / totalTrips
        : 0;
    return { totalTrips, totalDistance, totalEnergy, avgEfficiency };
  }, [filteredTrips]);

  const chartData = useMemo(() => {
    const chronological = [...filteredTrips].sort(
      (a, b) => a.startTime - b.startTime
    );
    return {
      labels: chronological.map((t) => formatDate(t.startTime)),
      datasets: [
        {
          label: 'Efficiency (Wh/mi)',
          data: chronological.map((t) => t.efficiency),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: 4,
          pointHoverRadius: 6,
        },
      ],
    };
  }, [filteredTrips]);

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: { parsed: { y: number } }) =>
            `${ctx.parsed.y.toFixed(1)} Wh/mi`,
        },
      },
    },
    scales: {
      y: {
        title: { display: true, text: 'Wh/mi' },
        beginAtZero: false,
      },
      x: {
        ticks: { maxTicksLimit: 10 },
      },
    },
  };

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  function handleExport() {
    const csv = exportTripsToCSV(filteredTrips);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `quagoev-trips-${dateRange}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  function tripDurationHours(trip: TripRecord): number {
    return (trip.endTime - trip.startTime) / 3600;
  }

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return '';
    return sortDir === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className="trip-history">
      <div className="trip-history-header">
        <h2>Trip History</h2>
        <p className="trip-history-subtitle">Digital Logbook</p>
      </div>

      {/* Controls */}
      <div className="trip-controls">
        <div className="trip-filters">
          <label className="trip-filter-label">Date Range</label>
          <select
            className="trip-filter-select"
            value={dateRange}
            onChange={(e) => setDateRange(e.target.value as DateRange)}
          >
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="last_3_months">Last 3 Months</option>
            <option value="all">All Time</option>
          </select>
        </div>
        <button className="btn btn-primary trip-export-btn" onClick={handleExport}>
          Export CSV
        </button>
      </div>

      {/* Summary Stats */}
      <div className="trip-summary">
        <div className="trip-stat-card">
          <span className="trip-stat-label">Total Trips</span>
          <span className="trip-stat-value">{stats.totalTrips}</span>
        </div>
        <div className="trip-stat-card">
          <span className="trip-stat-label">Total Distance</span>
          <span className="trip-stat-value">
            {formatDistance(stats.totalDistance)}
          </span>
        </div>
        <div className="trip-stat-card">
          <span className="trip-stat-label">Total Energy</span>
          <span className="trip-stat-value">
            {formatEnergy(stats.totalEnergy)}
          </span>
        </div>
        <div className="trip-stat-card">
          <span className="trip-stat-label">Avg Efficiency</span>
          <span className="trip-stat-value">
            {stats.avgEfficiency.toFixed(1)} Wh/mi
          </span>
        </div>
      </div>

      {/* Efficiency Trend Chart */}
      {filteredTrips.length > 1 && (
        <div className="efficiency-chart">
          <h3 className="efficiency-chart-title">Efficiency Trend</h3>
          <div className="efficiency-chart-container">
            <Line data={chartData} options={chartOptions} />
          </div>
        </div>
      )}

      {/* Trip Table */}
      <div className="trip-table-wrapper">
        <table className="trip-table">
          <thead>
            <tr>
              <th
                className="trip-table-header sortable"
                onClick={() => handleSort('date')}
              >
                Date{sortIndicator('date')}
              </th>
              <th className="trip-table-header">Duration</th>
              <th
                className="trip-table-header sortable"
                onClick={() => handleSort('distance')}
              >
                Distance{sortIndicator('distance')}
              </th>
              <th className="trip-table-header">Energy Used</th>
              <th
                className="trip-table-header sortable"
                onClick={() => handleSort('efficiency')}
              >
                Efficiency{sortIndicator('efficiency')}
              </th>
              <th className="trip-table-header">Battery</th>
            </tr>
          </thead>
          <tbody>
            {sortedTrips.length === 0 && (
              <tr>
                <td className="trip-table-empty" colSpan={6}>
                  No trips found for the selected date range.
                </td>
              </tr>
            )}
            {sortedTrips.map((trip) => (
              <TripRow
                key={trip.id}
                trip={trip}
                expanded={expandedId === trip.id}
                onToggle={() => toggleExpand(trip.id)}
                durationHours={tripDurationHours(trip)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TripRow({
  trip,
  expanded,
  onToggle,
  durationHours,
}: {
  trip: TripRecord;
  expanded: boolean;
  onToggle: () => void;
  durationHours: number;
}) {
  return (
    <>
      <tr className={`trip-row ${expanded ? 'expanded' : ''}`} onClick={onToggle}>
        <td className="trip-cell">{formatDate(trip.startTime)}</td>
        <td className="trip-cell">{formatDuration(durationHours)}</td>
        <td className="trip-cell">{formatDistance(trip.distance)}</td>
        <td className="trip-cell">{formatEnergy(trip.energyUsed)}</td>
        <td className="trip-cell">{trip.efficiency.toFixed(1)} Wh/mi</td>
        <td className="trip-cell">
          {Math.round(trip.startBattery)}% → {Math.round(trip.endBattery)}%
        </td>
      </tr>
      {expanded && (
        <tr className="trip-detail-row">
          <td colSpan={6}>
            <div className="trip-detail">
              <div className="trip-detail-grid">
                <div className="trip-detail-item">
                  <span className="trip-detail-label">Start Time</span>
                  <span className="trip-detail-value">
                    {formatDate(trip.startTime)} {formatTime(trip.startTime)}
                  </span>
                </div>
                <div className="trip-detail-item">
                  <span className="trip-detail-label">End Time</span>
                  <span className="trip-detail-value">
                    {formatDate(trip.endTime)} {formatTime(trip.endTime)}
                  </span>
                </div>
                <div className="trip-detail-item">
                  <span className="trip-detail-label">Start Location</span>
                  <span className="trip-detail-value">
                    {trip.startLocation.lat.toFixed(4)},{' '}
                    {trip.startLocation.lng.toFixed(4)}
                  </span>
                </div>
                <div className="trip-detail-item">
                  <span className="trip-detail-label">End Location</span>
                  <span className="trip-detail-value">
                    {trip.endLocation.lat.toFixed(4)},{' '}
                    {trip.endLocation.lng.toFixed(4)}
                  </span>
                </div>
                <div className="trip-detail-item">
                  <span className="trip-detail-label">Battery Used</span>
                  <span className="trip-detail-value">
                    {Math.round(trip.startBattery - trip.endBattery)}%
                  </span>
                </div>
                <div className="trip-detail-item">
                  <span className="trip-detail-label">Efficiency</span>
                  <span className="trip-detail-value">
                    {trip.efficiency.toFixed(1)} Wh/mi
                  </span>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
