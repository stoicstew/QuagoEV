import { useState, useMemo } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';
import { getSleepHistory, type SleepRecord } from '../utils/storage';
import { formatEnergy } from '../utils/format';

Chart.register(...registerables);

const DEFAULT_COST_PER_KWH = 0.12;

function computeScore(record: SleepRecord): number {
  if (record.totalParkedMinutes === 0) return 100;
  return (record.totalAsleepMinutes / record.totalParkedMinutes) * 100;
}

function scoreColor(score: number): string {
  if (score > 90) return '#22c55e';
  if (score >= 70) return '#eab308';
  return '#ef4444';
}

function scoreLabel(score: number): string {
  if (score > 90) return 'Excellent';
  if (score >= 70) return 'Fair';
  return 'Poor';
}

type Period = 'week' | 'month';

function filterByPeriod(records: SleepRecord[], period: Period): SleepRecord[] {
  const now = new Date();
  const cutoff = new Date();
  if (period === 'week') {
    cutoff.setDate(now.getDate() - 7);
  } else {
    cutoff.setDate(now.getDate() - 30);
  }
  return records.filter((r) => new Date(r.date) >= cutoff);
}

function getPreviousPeriod(records: SleepRecord[], period: Period): SleepRecord[] {
  const now = new Date();
  const days = period === 'week' ? 7 : 30;
  const start = new Date();
  start.setDate(now.getDate() - days * 2);
  const end = new Date();
  end.setDate(now.getDate() - days);
  return records.filter((r) => {
    const d = new Date(r.date);
    return d >= start && d < end;
  });
}

export default function SleepScore() {
  const [period, setPeriod] = useState<Period>('week');
  const allRecords = useMemo(() => getSleepHistory(), []);
  const records = useMemo(() => filterByPeriod(allRecords, period), [allRecords, period]);
  const previousRecords = useMemo(() => getPreviousPeriod(allRecords, period), [allRecords, period]);

  // Current / latest score
  const latestRecord = allRecords.length > 0 ? allRecords[allRecords.length - 1] : null;
  const currentScore = latestRecord ? computeScore(latestRecord) : 0;

  // Averages for current period
  const avgScore =
    records.length > 0
      ? records.reduce((sum, r) => sum + computeScore(r), 0) / records.length
      : 0;

  const prevAvgScore =
    previousRecords.length > 0
      ? previousRecords.reduce((sum, r) => sum + computeScore(r), 0) / previousRecords.length
      : 0;

  const totalDrain = records.reduce((sum, r) => sum + r.phantomDrainKwh, 0);
  const prevTotalDrain = previousRecords.reduce((sum, r) => sum + r.phantomDrainKwh, 0);
  const totalCost = totalDrain * DEFAULT_COST_PER_KWH;

  // Breakdown stats
  const sentryDays = records.filter((r) => r.sentryModeActive).length;
  const overheatDays = records.filter((r) => r.cabinOverheatActive).length;
  const suspectedPollingDays = records.filter(
    (r) => computeScore(r) < 70 && !r.sentryModeActive && !r.cabinOverheatActive
  ).length;

  // Chart data: daily sleep scores
  const scoreChartData = {
    labels: records.map((r) => r.date),
    datasets: [
      {
        label: 'Sleep Score',
        data: records.map((r) => Math.round(computeScore(r))),
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        fill: true,
        tension: 0.3,
        pointBackgroundColor: records.map((r) => scoreColor(computeScore(r))),
        pointRadius: 4,
      },
    ],
  };

  const scoreChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      y: {
        min: 0,
        max: 100,
        ticks: { color: '#94a3b8' },
        grid: { color: 'rgba(148,163,184,0.1)' },
      },
      x: {
        ticks: { color: '#94a3b8', maxRotation: 45 },
        grid: { display: false },
      },
    },
  };

  // Chart data: phantom drain
  const drainChartData = {
    labels: records.map((r) => r.date),
    datasets: [
      {
        label: 'Phantom Drain (kWh)',
        data: records.map((r) => r.phantomDrainKwh),
        backgroundColor: records.map((r) =>
          r.phantomDrainKwh > 1.5 ? 'rgba(239,68,68,0.7)' : 'rgba(99,102,241,0.7)'
        ),
        borderRadius: 4,
      },
    ],
  };

  const drainChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
    },
    scales: {
      y: {
        beginAtZero: true,
        ticks: { color: '#94a3b8' },
        grid: { color: 'rgba(148,163,184,0.1)' },
      },
      x: {
        ticks: { color: '#94a3b8', maxRotation: 45 },
        grid: { display: false },
      },
    },
  };

  // Generate tips
  const tips: string[] = [];
  if (sentryDays > records.length * 0.5) {
    tips.push(
      'Sentry Mode was active on most days. Consider limiting it to specific locations (e.g., public parking lots) to reduce energy drain.'
    );
  }
  if (totalDrain > records.length * 1.0) {
    tips.push(
      'Your phantom drain is higher than average. Check for third-party apps (TeslaFi, Stats, etc.) that poll your vehicle frequently and increase their polling interval.'
    );
  }
  if (overheatDays > records.length * 0.3) {
    tips.push(
      'Cabin Overheat Protection was frequently active. While it protects your interior, it can use 1-3 kWh per day. Consider setting it to "Fan Only" mode or disabling it in cooler weather.'
    );
  }
  if (currentScore > 90 && tips.length === 0) {
    tips.push('Your vehicle is sleeping efficiently. Keep up the good work!');
  }
  if (suspectedPollingDays > 0) {
    tips.push(
      `On ${suspectedPollingDays} day(s), the car had a low sleep score without Sentry Mode or Cabin Overheat active. Third-party app polling is the most likely cause.`
    );
  }

  // SVG gauge helpers
  const gaugeRadius = 70;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeProgress = (currentScore / 100) * gaugeCircumference;

  const scoreDelta = avgScore - prevAvgScore;
  const drainDelta = totalDrain - prevTotalDrain;

  return (
    <div className="sleep-score">
      <h1 className="sleep-score-title">Sleep Score &amp; Energy Conservation</h1>

      {/* Period toggle */}
      <div className="period-toggle">
        <button
          className={`period-btn ${period === 'week' ? 'active' : ''}`}
          onClick={() => setPeriod('week')}
        >
          Weekly
        </button>
        <button
          className={`period-btn ${period === 'month' ? 'active' : ''}`}
          onClick={() => setPeriod('month')}
        >
          Monthly
        </button>
      </div>

      {/* Score gauge + summary row */}
      <div className="score-overview">
        <div className="score-gauge">
          <svg viewBox="0 0 180 180" className="gauge-svg">
            <circle
              cx="90"
              cy="90"
              r={gaugeRadius}
              fill="none"
              stroke="#1e293b"
              strokeWidth="12"
            />
            <circle
              cx="90"
              cy="90"
              r={gaugeRadius}
              fill="none"
              stroke={scoreColor(currentScore)}
              strokeWidth="12"
              strokeDasharray={`${gaugeProgress} ${gaugeCircumference}`}
              strokeDashoffset={0}
              strokeLinecap="round"
              transform="rotate(-90 90 90)"
              className="gauge-progress"
            />
            <text
              x="90"
              y="82"
              textAnchor="middle"
              className="gauge-score-text"
              fill={scoreColor(currentScore)}
            >
              {Math.round(currentScore)}
            </text>
            <text x="90" y="105" textAnchor="middle" className="gauge-label-text" fill="#94a3b8">
              {scoreLabel(currentScore)}
            </text>
          </svg>
          <p className="gauge-caption">Current Sleep Score</p>
        </div>

        {/* Summary cards */}
        <div className="summary-cards">
          <div className="summary-card">
            <span className="summary-value">{Math.round(avgScore)}</span>
            <span className="summary-label">Avg Score ({period})</span>
            {previousRecords.length > 0 && (
              <span className={`summary-delta ${scoreDelta >= 0 ? 'positive' : 'negative'}`}>
                {scoreDelta >= 0 ? '+' : ''}
                {scoreDelta.toFixed(1)} vs prior
              </span>
            )}
          </div>
          <div className="summary-card">
            <span className="summary-value">{formatEnergy(totalDrain)}</span>
            <span className="summary-label">Total Drain ({period})</span>
            {previousRecords.length > 0 && (
              <span className={`summary-delta ${drainDelta <= 0 ? 'positive' : 'negative'}`}>
                {drainDelta >= 0 ? '+' : ''}
                {drainDelta.toFixed(2)} kWh vs prior
              </span>
            )}
          </div>
          <div className="summary-card">
            <span className="summary-value">${totalCost.toFixed(2)}</span>
            <span className="summary-label">Energy Wasted</span>
            <span className="summary-sub">@ ${DEFAULT_COST_PER_KWH}/kWh</span>
          </div>
          <div className="summary-card">
            <span className="summary-value">{records.length}</span>
            <span className="summary-label">Days Tracked</span>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="charts-row">
        <div className="chart-card">
          <h2 className="chart-title">Sleep Score History</h2>
          <div className="chart-container">
            {records.length > 0 ? (
              <Line data={scoreChartData} options={scoreChartOptions} />
            ) : (
              <p className="chart-empty">No data available yet.</p>
            )}
          </div>
        </div>

        <div className="chart-card drain-chart">
          <h2 className="chart-title">Phantom Drain</h2>
          <div className="chart-container">
            {records.length > 0 ? (
              <Bar data={drainChartData} options={drainChartOptions} />
            ) : (
              <p className="chart-empty">No data available yet.</p>
            )}
          </div>
        </div>
      </div>

      {/* Breakdown card */}
      <div className="breakdown-card">
        <h2 className="breakdown-title">What's Keeping Your Car Awake</h2>
        <div className="breakdown-items">
          <div className={`breakdown-item ${sentryDays > 0 ? 'active' : ''}`}>
            <div className="breakdown-icon">🛡</div>
            <div className="breakdown-detail">
              <span className="breakdown-name">Sentry Mode</span>
              <span className="breakdown-stat">
                Active {sentryDays} of {records.length} days
              </span>
            </div>
            <div className="breakdown-badge">
              {sentryDays > 0 ? 'Contributing' : 'Off'}
            </div>
          </div>

          <div className={`breakdown-item ${overheatDays > 0 ? 'active' : ''}`}>
            <div className="breakdown-icon">🌡</div>
            <div className="breakdown-detail">
              <span className="breakdown-name">Cabin Overheat Protection</span>
              <span className="breakdown-stat">
                Active {overheatDays} of {records.length} days
              </span>
            </div>
            <div className="breakdown-badge">
              {overheatDays > 0 ? 'Contributing' : 'Off'}
            </div>
          </div>

          <div className={`breakdown-item ${suspectedPollingDays > 0 ? 'active' : ''}`}>
            <div className="breakdown-icon">📡</div>
            <div className="breakdown-detail">
              <span className="breakdown-name">Third-Party App Polling</span>
              <span className="breakdown-stat">
                Suspected on {suspectedPollingDays} day(s)
              </span>
            </div>
            <div className="breakdown-badge">
              {suspectedPollingDays > 0 ? 'Likely' : 'Unlikely'}
            </div>
          </div>
        </div>
      </div>

      {/* Tips section */}
      {tips.length > 0 && (
        <div className="tips-section">
          <h2 className="tips-title">Energy Conservation Tips</h2>
          <ul className="tips-list">
            {tips.map((tip, i) => (
              <li key={i} className="tip-item">
                {tip}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Weekly / Monthly comparison */}
      <div className="comparison-section">
        <h2 className="comparison-title">
          {period === 'week' ? 'Weekly' : 'Monthly'} Comparison
        </h2>
        {previousRecords.length > 0 ? (
          <table className="comparison-table">
            <thead>
              <tr>
                <th>Metric</th>
                <th>Current {period === 'week' ? 'Week' : 'Month'}</th>
                <th>Previous {period === 'week' ? 'Week' : 'Month'}</th>
                <th>Change</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Avg Sleep Score</td>
                <td>{avgScore.toFixed(1)}</td>
                <td>{prevAvgScore.toFixed(1)}</td>
                <td className={scoreDelta >= 0 ? 'positive' : 'negative'}>
                  {scoreDelta >= 0 ? '+' : ''}
                  {scoreDelta.toFixed(1)}
                </td>
              </tr>
              <tr>
                <td>Total Phantom Drain</td>
                <td>{formatEnergy(totalDrain)}</td>
                <td>{formatEnergy(prevTotalDrain)}</td>
                <td className={drainDelta <= 0 ? 'positive' : 'negative'}>
                  {drainDelta >= 0 ? '+' : ''}
                  {drainDelta.toFixed(2)} kWh
                </td>
              </tr>
              <tr>
                <td>Estimated Cost</td>
                <td>${totalCost.toFixed(2)}</td>
                <td>${(prevTotalDrain * DEFAULT_COST_PER_KWH).toFixed(2)}</td>
                <td className={(totalCost - prevTotalDrain * DEFAULT_COST_PER_KWH) <= 0 ? 'positive' : 'negative'}>
                  {(totalCost - prevTotalDrain * DEFAULT_COST_PER_KWH) >= 0 ? '+' : ''}
                  ${(totalCost - prevTotalDrain * DEFAULT_COST_PER_KWH).toFixed(2)}
                </td>
              </tr>
              <tr>
                <td>Sentry Mode Days</td>
                <td>{sentryDays}</td>
                <td>{previousRecords.filter((r) => r.sentryModeActive).length}</td>
                <td>
                  {sentryDays - previousRecords.filter((r) => r.sentryModeActive).length >= 0
                    ? '+'
                    : ''}
                  {sentryDays - previousRecords.filter((r) => r.sentryModeActive).length}
                </td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="comparison-empty">
            Not enough historical data for comparison. Keep tracking to see trends.
          </p>
        )}
      </div>
    </div>
  );
}
