import { useState, useEffect, useMemo } from 'react';
import { Line } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';
import { getBatterySnapshots, type BatterySnapshot } from '../utils/storage';
import { useVehicleData } from '../hooks/useTesla';
import { formatDistance, formatPercent } from '../utils/format';

Chart.register(...registerables);

const EPA_RATED_RANGES: Record<string, number> = {
  'Model 3': 272,
  'Model 3 LR': 358,
  'Model Y': 310,
  'Model S': 405,
};

const FLEET_BENCHMARKS = [
  { label: 'First year', degradation: '1-2%', miles: '0-15k' },
  { label: 'By 50k miles', degradation: '~5%', miles: '50k' },
  { label: 'By 100k miles', degradation: '~8%', miles: '100k' },
  { label: 'By 200k miles', degradation: '~12%', miles: '200k' },
];

type ChartXAxis = 'date' | 'odometer';

interface ChargingHabitsStats {
  averageChargeLevel: number;
  chargesAbove90Pct: number;
  chargesBelow10Pct: number;
  totalSnapshots: number;
  above90Ratio: number;
  below10Ratio: number;
}

function computeChargingHabits(snapshots: BatterySnapshot[]): ChargingHabitsStats {
  if (snapshots.length === 0) {
    return {
      averageChargeLevel: 0,
      chargesAbove90Pct: 0,
      chargesBelow10Pct: 0,
      totalSnapshots: 0,
      above90Ratio: 0,
      below10Ratio: 0,
    };
  }

  let totalLevel = 0;
  let above90 = 0;
  let below10 = 0;

  for (const snap of snapshots) {
    totalLevel += snap.batteryLevel;
    if (snap.batteryLevel > 90) above90++;
    if (snap.batteryLevel < 10) below10++;
  }

  const count = snapshots.length;
  return {
    averageChargeLevel: totalLevel / count,
    chargesAbove90Pct: above90,
    chargesBelow10Pct: below10,
    totalSnapshots: count,
    above90Ratio: (above90 / count) * 100,
    below10Ratio: (below10 / count) * 100,
  };
}

function generateBatteryTips(habits: ChargingHabitsStats): string[] {
  const tips: string[] = [];

  if (habits.above90Ratio > 30) {
    tips.push(
      'You charge above 90% frequently. Keeping daily charge between 20-80% helps preserve long-term battery health.'
    );
  }

  if (habits.below10Ratio > 15) {
    tips.push(
      'Your battery drops below 10% often. Try to avoid deep discharges — staying above 20% reduces stress on the cells.'
    );
  }

  if (habits.averageChargeLevel > 85) {
    tips.push(
      'Your average charge level is high. For daily driving, a charge limit of 80% is recommended by Tesla.'
    );
  } else if (habits.averageChargeLevel < 30) {
    tips.push(
      'Your average charge level is quite low. Keeping the battery between 20-80% is ideal for longevity.'
    );
  }

  if (habits.above90Ratio <= 10 && habits.below10Ratio <= 5 && habits.averageChargeLevel >= 40 && habits.averageChargeLevel <= 80) {
    tips.push(
      'Your charging habits are excellent. You are keeping the battery in its optimal range.'
    );
  }

  if (tips.length === 0) {
    tips.push(
      'Keep your daily charge limit between 20-80% and only charge to 100% before long trips.',
      'Avoid leaving the car at very low or very high state of charge for extended periods.',
      'Precondition the battery before fast charging in cold weather for optimal charging speed and battery health.'
    );
  }

  return tips;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: '2-digit',
  });
}

interface BatteryHealthProps {
  vehicleId: number | null;
  model?: string;
}

export default function BatteryHealth({ vehicleId, model }: BatteryHealthProps) {
  const { data, loading } = useVehicleData(vehicleId);
  const [snapshots, setSnapshots] = useState<BatterySnapshot[]>([]);
  const [xAxis, setXAxis] = useState<ChartXAxis>('date');
  const [selectedModel, setSelectedModel] = useState<string>(model ?? 'Model 3');

  useEffect(() => {
    setSnapshots(getBatterySnapshots());
  }, []);

  // Derive current max range from live data
  const currentMaxRange = useMemo(() => {
    if (!data) return null;
    const { ideal_battery_range, battery_level } = data.charge_state;
    if (battery_level <= 0) return null;
    return (ideal_battery_range / battery_level) * 100;
  }, [data]);

  const epaRange = EPA_RATED_RANGES[selectedModel] ?? EPA_RATED_RANGES['Model 3'];

  const healthPercent = useMemo(() => {
    if (currentMaxRange == null) return null;
    return Math.min((currentMaxRange / epaRange) * 100, 100);
  }, [currentMaxRange, epaRange]);

  // Degradation from snapshots
  const degradationPercent = useMemo(() => {
    if (snapshots.length < 2) return null;
    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    if (first.maxRange <= 0) return null;
    return ((first.maxRange - last.maxRange) / first.maxRange) * 100;
  }, [snapshots]);

  // Charging habits
  const chargingHabits = useMemo(() => computeChargingHabits(snapshots), [snapshots]);
  const batteryTips = useMemo(() => generateBatteryTips(chargingHabits), [chargingHabits]);

  // Chart data
  const chartData = useMemo(() => {
    const sorted = [...snapshots].sort((a, b) => a.timestamp - b.timestamp);
    const labels =
      xAxis === 'date'
        ? sorted.map((s) => formatDate(s.timestamp))
        : sorted.map((s) => formatDistance(s.odometer));

    return {
      labels,
      datasets: [
        {
          label: 'Max Range (mi)',
          data: sorted.map((s) => s.maxRange),
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          fill: true,
          tension: 0.3,
          pointRadius: sorted.length > 60 ? 0 : 3,
          pointHoverRadius: 5,
        },
        {
          label: `EPA Rated (${selectedModel})`,
          data: sorted.map(() => epaRange),
          borderColor: 'rgba(100, 116, 139, 0.5)',
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
        },
      ],
    };
  }, [snapshots, xAxis, epaRange, selectedModel]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'top' as const },
        tooltip: {
          callbacks: {
            label: (ctx: { dataset: { label?: string }; parsed: { y: number } }) =>
              `${ctx.dataset.label}: ${ctx.parsed.y.toFixed(1)} mi`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: xAxis === 'date' ? 'Date' : 'Odometer' },
          ticks: { maxTicksLimit: 12 },
        },
        y: {
          title: { display: true, text: 'Max Range (mi)' },
          beginAtZero: false,
        },
      },
    }),
    [xAxis]
  );

  // Health bar color
  function healthColor(pct: number): string {
    if (pct >= 95) return 'var(--color-success, #22c55e)';
    if (pct >= 85) return 'var(--color-warning, #eab308)';
    return 'var(--color-danger, #ef4444)';
  }

  if (loading && !data) {
    return (
      <div className="battery-health">
        <div className="battery-health-loading">
          <div className="spinner" />
          <p>Loading battery data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="battery-health">
      <header className="battery-health-header">
        <h1>Battery Health &amp; Degradation</h1>
        <div className="model-selector">
          <label htmlFor="model-select">Compare to:</label>
          <select
            id="model-select"
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
          >
            {Object.keys(EPA_RATED_RANGES).map((m) => (
              <option key={m} value={m}>
                {m} ({EPA_RATED_RANGES[m]} mi EPA)
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Health Summary Card */}
      <section className="health-summary">
        <h2>Current Health</h2>
        <div className="health-summary-grid">
          <div className="health-metric">
            <span className="health-metric-label">Estimated Max Range</span>
            <span className="health-metric-value">
              {currentMaxRange != null ? formatDistance(currentMaxRange) : '—'}
            </span>
          </div>
          <div className="health-metric">
            <span className="health-metric-label">EPA Rated Range ({selectedModel})</span>
            <span className="health-metric-value">{formatDistance(epaRange)}</span>
          </div>
          <div className="health-metric">
            <span className="health-metric-label">Battery Health</span>
            <span className="health-metric-value">
              {healthPercent != null ? formatPercent(healthPercent) : '—'}
            </span>
          </div>
          <div className="health-metric">
            <span className="health-metric-label">Total Degradation (recorded)</span>
            <span className="health-metric-value">
              {degradationPercent != null ? formatPercent(degradationPercent) : '—'}
            </span>
          </div>
        </div>

        {healthPercent != null && (
          <div className="health-bar-container">
            <div className="health-bar-track">
              <div
                className="health-bar-fill"
                style={{
                  width: `${Math.min(healthPercent, 100)}%`,
                  backgroundColor: healthColor(healthPercent),
                }}
              />
            </div>
            <div className="health-bar-labels">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
        )}
      </section>

      {/* Degradation Chart */}
      <section className="degradation-chart">
        <div className="degradation-chart-header">
          <h2>Degradation Over Time</h2>
          <div className="chart-axis-toggle">
            <button
              className={`toggle-btn ${xAxis === 'date' ? 'active' : ''}`}
              onClick={() => setXAxis('date')}
            >
              By Date
            </button>
            <button
              className={`toggle-btn ${xAxis === 'odometer' ? 'active' : ''}`}
              onClick={() => setXAxis('odometer')}
            >
              By Odometer
            </button>
          </div>
        </div>
        {snapshots.length > 1 ? (
          <div className="chart-wrapper">
            <Line data={chartData} options={chartOptions} />
          </div>
        ) : (
          <div className="chart-empty">
            <p>
              Not enough data yet. Battery snapshots are recorded daily — check back after a few
              days of use.
            </p>
          </div>
        )}
      </section>

      {/* Fleet Benchmark */}
      <section className="fleet-benchmark">
        <h2>Fleet Benchmark</h2>
        <p className="fleet-benchmark-description">
          See how your battery compares to typical Tesla fleet degradation averages.
        </p>
        <div className="benchmark-table">
          <div className="benchmark-row benchmark-header-row">
            <span className="benchmark-cell">Milestone</span>
            <span className="benchmark-cell">Typical Degradation</span>
            <span className="benchmark-cell">Mileage</span>
            <span className="benchmark-cell">Your Status</span>
          </div>
          {FLEET_BENCHMARKS.map((bench) => {
            let userStatus = '—';
            if (degradationPercent != null && snapshots.length > 0) {
              const latestOdometer = snapshots[snapshots.length - 1].odometer;
              const mileThreshold = parseInt(bench.miles.replace(/[^0-9]/g, ''), 10) * 1000;
              if (bench.miles.includes('-')) {
                // Range like "0-15k"
                const parts = bench.miles.split('-');
                const upper = parseInt(parts[1].replace(/[^0-9]/g, ''), 10) * 1000;
                if (latestOdometer <= upper) {
                  userStatus = formatPercent(degradationPercent);
                }
              } else if (latestOdometer >= mileThreshold * 0.8) {
                userStatus = formatPercent(degradationPercent);
              }
            }

            return (
              <div key={bench.label} className="benchmark-row">
                <span className="benchmark-cell benchmark-label">{bench.label}</span>
                <span className="benchmark-cell">{bench.degradation}</span>
                <span className="benchmark-cell">{bench.miles} mi</span>
                <span className="benchmark-cell benchmark-status">{userStatus}</span>
              </div>
            );
          })}
        </div>
        {degradationPercent != null && (
          <div className="benchmark-summary">
            <p>
              Your recorded degradation of <strong>{formatPercent(degradationPercent)}</strong> over{' '}
              <strong>
                {formatDistance(
                  snapshots[snapshots.length - 1].odometer - snapshots[0].odometer
                )}
              </strong>{' '}
              of driving.
            </p>
          </div>
        )}
      </section>

      {/* Charging Habits Impact */}
      <section className="charging-habits">
        <h2>Charging Habits Impact</h2>
        {chargingHabits.totalSnapshots > 0 ? (
          <div className="charging-habits-grid">
            <div className="habit-card">
              <span className="habit-card-value">
                {formatPercent(chargingHabits.averageChargeLevel)}
              </span>
              <span className="habit-card-label">Average Charge Level</span>
              <span className="habit-card-detail">
                {chargingHabits.averageChargeLevel >= 40 &&
                chargingHabits.averageChargeLevel <= 80
                  ? 'Optimal range'
                  : chargingHabits.averageChargeLevel > 80
                    ? 'Consider lowering daily limit'
                    : 'Consider charging more frequently'}
              </span>
            </div>
            <div className="habit-card">
              <span className="habit-card-value">{chargingHabits.chargesAbove90Pct}</span>
              <span className="habit-card-label">Charges Above 90%</span>
              <span className="habit-card-detail">
                {formatPercent(chargingHabits.above90Ratio)} of recorded snapshots
              </span>
              <div className="habit-bar-track">
                <div
                  className="habit-bar-fill"
                  style={{
                    width: `${Math.min(chargingHabits.above90Ratio, 100)}%`,
                    backgroundColor:
                      chargingHabits.above90Ratio > 30
                        ? 'var(--color-danger, #ef4444)'
                        : chargingHabits.above90Ratio > 15
                          ? 'var(--color-warning, #eab308)'
                          : 'var(--color-success, #22c55e)',
                  }}
                />
              </div>
            </div>
            <div className="habit-card">
              <span className="habit-card-value">{chargingHabits.chargesBelow10Pct}</span>
              <span className="habit-card-label">Deep Discharges (Below 10%)</span>
              <span className="habit-card-detail">
                {formatPercent(chargingHabits.below10Ratio)} of recorded snapshots
              </span>
              <div className="habit-bar-track">
                <div
                  className="habit-bar-fill"
                  style={{
                    width: `${Math.min(chargingHabits.below10Ratio, 100)}%`,
                    backgroundColor:
                      chargingHabits.below10Ratio > 15
                        ? 'var(--color-danger, #ef4444)'
                        : chargingHabits.below10Ratio > 5
                          ? 'var(--color-warning, #eab308)'
                          : 'var(--color-success, #22c55e)',
                  }}
                />
              </div>
            </div>
          </div>
        ) : (
          <p className="charging-habits-empty">
            No battery snapshots recorded yet. Charging habit analysis will appear as data is
            collected.
          </p>
        )}
      </section>

      {/* Battery Tips */}
      <section className="battery-tips">
        <h2>Battery Care Tips</h2>
        <ul className="tips-list">
          {batteryTips.map((tip, i) => (
            <li key={i} className="tip-item">
              {tip}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
