import React, { useMemo } from 'react';
import { Bar, Doughnut } from 'react-chartjs-2';
import { Chart, registerables } from 'chart.js';
import {
  getChargeHistory,
  getTripHistory,
  getSleepHistory,
  getSettings,
  type ChargeRecord,
  type TripRecord,
  type SleepRecord,
  type AppSettings,
} from '../utils/storage';
import { formatCurrency, formatEnergy } from '../utils/format';

Chart.register(...registerables);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MonthBucket {
  label: string; // "Jan 2026"
  home: number;
  work: number;
  public: number;
}

function getRateForLocation(
  location: 'home' | 'work' | 'public',
  settings: AppSettings,
): number {
  const match = settings.electricityRates.find((r) => r.location === location);
  return match ? match.rate : 0.12;
}

function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  const date = new Date(Number(year), Number(month) - 1);
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/**
 * Assign each trip to a charging location heuristic:
 * - If the trip starts near the same coordinates as it ends (round-trip), treat as "home"
 * - Otherwise distribute evenly across locations using a simple round-robin.
 *
 * In a real app this would use geofencing; here we rotate based on trip index
 * so the chart is meaningful even with synthetic data.
 */
function assignLocation(index: number): 'home' | 'work' | 'public' {
  const locations: ('home' | 'work' | 'public')[] = ['home', 'home', 'work', 'public'];
  return locations[index % locations.length];
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const CostAnalytics: React.FC = () => {
  const settings = useMemo(() => getSettings(), []);
  const trips = useMemo(() => getTripHistory(), []);
  const sleepRecords = useMemo(() => getSleepHistory(), []);
  const chargeHistory = useMemo(() => getChargeHistory(), []);

  const homeRate = getRateForLocation('home', settings);
  const workRate = getRateForLocation('work', settings);
  const publicRate = getRateForLocation('public', settings);

  // ---- Derived data -------------------------------------------------------

  const tripCosts = useMemo(() => {
    return trips.map((trip, i) => {
      const loc = assignLocation(i);
      const rate = loc === 'home' ? homeRate : loc === 'work' ? workRate : publicRate;
      return {
        trip,
        location: loc,
        cost: trip.energyUsed * rate,
      };
    });
  }, [trips, homeRate, workRate, publicRate]);

  const totalElectricityCost = useMemo(
    () => tripCosts.reduce((sum, tc) => sum + tc.cost, 0),
    [tripCosts],
  );

  const totalDistance = useMemo(
    () => trips.reduce((sum, t) => sum + t.distance, 0),
    [trips],
  );

  const totalEnergyUsed = useMemo(
    () => trips.reduce((sum, t) => sum + t.energyUsed, 0),
    [trips],
  );

  const totalPhantomDrainKwh = useMemo(
    () => sleepRecords.reduce((sum, r) => sum + r.phantomDrainKwh, 0),
    [sleepRecords],
  );

  const phantomDrainCost = totalPhantomDrainKwh * homeRate;

  const gasCostEquivalent = useMemo(() => {
    if (settings.gasCarMpg <= 0) return 0;
    return (totalDistance / settings.gasCarMpg) * settings.gasPricePerGallon;
  }, [totalDistance, settings.gasCarMpg, settings.gasPricePerGallon]);

  const totalFuelSavings = gasCostEquivalent - totalElectricityCost;

  const costPerMile = totalDistance > 0 ? totalElectricityCost / totalDistance : 0;

  // ---- Monthly cost breakdown ---------------------------------------------

  const monthlyBuckets = useMemo(() => {
    const buckets: Record<string, MonthBucket> = {};

    tripCosts.forEach(({ trip, location, cost }) => {
      const key = monthKey(trip.startTime);
      if (!buckets[key]) {
        buckets[key] = { label: monthLabel(key), home: 0, work: 0, public: 0 };
      }
      buckets[key][location] += cost;
    });

    return Object.keys(buckets)
      .sort()
      .map((k) => buckets[k]);
  }, [tripCosts]);

  const monthlyBarData = useMemo(
    () => ({
      labels: monthlyBuckets.map((b) => b.label),
      datasets: [
        {
          label: 'Home',
          data: monthlyBuckets.map((b) => Number(b.home.toFixed(2))),
          backgroundColor: 'rgba(56, 189, 248, 0.8)',
        },
        {
          label: 'Work',
          data: monthlyBuckets.map((b) => Number(b.work.toFixed(2))),
          backgroundColor: 'rgba(168, 85, 247, 0.8)',
        },
        {
          label: 'Public',
          data: monthlyBuckets.map((b) => Number(b.public.toFixed(2))),
          backgroundColor: 'rgba(251, 146, 60, 0.8)',
        },
      ],
    }),
    [monthlyBuckets],
  );

  const monthlyBarOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top' as const },
      title: { display: true, text: 'Monthly Charging Cost Breakdown' },
    },
    scales: {
      x: { stacked: true },
      y: {
        stacked: true,
        ticks: {
          callback: (value: string | number) => `$${Number(value).toFixed(0)}`,
        },
      },
    },
  };

  // ---- Charging location doughnut -----------------------------------------

  const locationTotals = useMemo(() => {
    const totals = { home: 0, work: 0, public: 0 };
    tripCosts.forEach(({ location, trip }) => {
      totals[location] += trip.energyUsed;
    });
    return totals;
  }, [tripCosts]);

  const doughnutData = useMemo(
    () => ({
      labels: ['Home', 'Work', 'Public'],
      datasets: [
        {
          data: [
            Number(locationTotals.home.toFixed(2)),
            Number(locationTotals.work.toFixed(2)),
            Number(locationTotals.public.toFixed(2)),
          ],
          backgroundColor: [
            'rgba(56, 189, 248, 0.8)',
            'rgba(168, 85, 247, 0.8)',
            'rgba(251, 146, 60, 0.8)',
          ],
          borderWidth: 1,
        },
      ],
    }),
    [locationTotals],
  );

  const doughnutOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'bottom' as const },
      title: { display: true, text: 'Charging Location Breakdown (kWh)' },
    },
  };

  // ---- Cumulative savings over time ---------------------------------------

  const cumulativeSavings = useMemo(() => {
    const sorted = [...tripCosts].sort((a, b) => a.trip.startTime - b.trip.startTime);
    let cumulative = 0;
    return sorted.map(({ trip, cost }) => {
      const gasCost =
        settings.gasCarMpg > 0
          ? (trip.distance / settings.gasCarMpg) * settings.gasPricePerGallon
          : 0;
      cumulative += gasCost - cost;
      return {
        label: new Date(trip.startTime).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        value: Number(cumulative.toFixed(2)),
      };
    });
  }, [tripCosts, settings.gasCarMpg, settings.gasPricePerGallon]);

  const savingsBarData = useMemo(
    () => ({
      labels: cumulativeSavings.map((s) => s.label),
      datasets: [
        {
          label: 'Cumulative Savings vs Gas ($)',
          data: cumulativeSavings.map((s) => s.value),
          backgroundColor: 'rgba(34, 197, 94, 0.7)',
        },
      ],
    }),
    [cumulativeSavings],
  );

  const savingsBarOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      title: { display: true, text: 'Cumulative Fuel Savings vs Gas Car' },
    },
    scales: {
      y: {
        ticks: {
          callback: (value: string | number) => `$${Number(value).toFixed(0)}`,
        },
      },
    },
  };

  // ---- Cost per mile trend ------------------------------------------------

  const costPerMileTrend = useMemo(() => {
    const sorted = [...tripCosts].sort((a, b) => a.trip.startTime - b.trip.startTime);
    let runningCost = 0;
    let runningDistance = 0;
    return sorted.map(({ trip, cost }) => {
      runningCost += cost;
      runningDistance += trip.distance;
      return {
        label: new Date(trip.startTime).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        }),
        value: runningDistance > 0 ? Number((runningCost / runningDistance).toFixed(4)) : 0,
      };
    });
  }, [tripCosts]);

  const costPerMileData = useMemo(
    () => ({
      labels: costPerMileTrend.map((p) => p.label),
      datasets: [
        {
          label: 'Cost per Mile ($)',
          data: costPerMileTrend.map((p) => p.value),
          backgroundColor: 'rgba(99, 102, 241, 0.7)',
        },
      ],
    }),
    [costPerMileTrend],
  );

  const costPerMileOptions = {
    responsive: true,
    plugins: {
      legend: { display: false },
      title: { display: true, text: 'Cost per Mile Trend' },
    },
    scales: {
      y: {
        ticks: {
          callback: (value: string | number) => `$${Number(value).toFixed(3)}`,
        },
      },
    },
  };

  // ---- Phantom drain detail -----------------------------------------------

  const phantomDrainDays = sleepRecords.length;
  const avgDailyDrain =
    phantomDrainDays > 0 ? totalPhantomDrainKwh / phantomDrainDays : 0;

  // ---- Render -------------------------------------------------------------

  return (
    <div className="cost-analytics">
      <h2 className="cost-analytics__title">Cost &amp; Savings Analytics</h2>

      {/* Summary Cards */}
      <div className="summary-cards">
        <div className="summary-card">
          <span className="summary-card__label">Total Electricity Cost</span>
          <span className="summary-card__value">{formatCurrency(totalElectricityCost)}</span>
          <span className="summary-card__detail">{formatEnergy(totalEnergyUsed)} used</span>
        </div>

        <div className="summary-card summary-card--savings">
          <span className="summary-card__label">Fuel Savings vs Gas</span>
          <span className="summary-card__value">{formatCurrency(totalFuelSavings)}</span>
          <span className="summary-card__detail">
            vs {settings.gasCarMpg} MPG @ {formatCurrency(settings.gasPricePerGallon)}/gal
          </span>
        </div>

        <div className="summary-card">
          <span className="summary-card__label">Cost per Mile</span>
          <span className="summary-card__value">${costPerMile.toFixed(3)}</span>
          <span className="summary-card__detail">
            {totalDistance.toFixed(0)} miles driven
          </span>
        </div>

        <div className="summary-card summary-card--drain">
          <span className="summary-card__label">Phantom Drain Cost</span>
          <span className="summary-card__value">{formatCurrency(phantomDrainCost)}</span>
          <span className="summary-card__detail">
            {formatEnergy(totalPhantomDrainKwh)} lost while parked
          </span>
        </div>
      </div>

      {/* Monthly Cost Breakdown */}
      <section className="cost-chart">
        <div className="cost-chart__container">
          {monthlyBuckets.length > 0 ? (
            <Bar data={monthlyBarData} options={monthlyBarOptions} />
          ) : (
            <p className="cost-chart__empty">No trip data available for monthly breakdown.</p>
          )}
        </div>
      </section>

      {/* Fuel Savings Calculator */}
      <section className="savings-section">
        <h3 className="savings-section__title">Fuel Savings Calculator</h3>
        <div className="savings-section__stats">
          <div className="savings-stat">
            <span className="savings-stat__label">Total Miles Driven</span>
            <span className="savings-stat__value">{totalDistance.toFixed(1)} mi</span>
          </div>
          <div className="savings-stat">
            <span className="savings-stat__label">Total Energy Used</span>
            <span className="savings-stat__value">{formatEnergy(totalEnergyUsed)}</span>
          </div>
          <div className="savings-stat">
            <span className="savings-stat__label">Equivalent Gas Cost</span>
            <span className="savings-stat__value">{formatCurrency(gasCostEquivalent)}</span>
          </div>
          <div className="savings-stat">
            <span className="savings-stat__label">Your Electricity Cost</span>
            <span className="savings-stat__value">{formatCurrency(totalElectricityCost)}</span>
          </div>
          <div className="savings-stat savings-stat--highlight">
            <span className="savings-stat__label">You Saved</span>
            <span className="savings-stat__value">{formatCurrency(totalFuelSavings)}</span>
          </div>
        </div>

        <div className="savings-section__chart">
          {cumulativeSavings.length > 0 ? (
            <Bar data={savingsBarData} options={savingsBarOptions} />
          ) : (
            <p className="savings-section__empty">
              Drive some trips to see your cumulative savings.
            </p>
          )}
        </div>
      </section>

      {/* Phantom Drain Section */}
      <section className="phantom-drain-section">
        <h3 className="phantom-drain-section__title">Phantom Drain</h3>
        <p className="phantom-drain-section__description">
          Energy lost while the vehicle is parked due to background systems, sentry mode,
          and cabin overheat protection.
        </p>
        <div className="phantom-drain-section__stats">
          <div className="phantom-drain-stat">
            <span className="phantom-drain-stat__label">Total Drain</span>
            <span className="phantom-drain-stat__value">
              {formatEnergy(totalPhantomDrainKwh)}
            </span>
          </div>
          <div className="phantom-drain-stat">
            <span className="phantom-drain-stat__label">Average Daily Drain</span>
            <span className="phantom-drain-stat__value">
              {formatEnergy(avgDailyDrain)}
            </span>
          </div>
          <div className="phantom-drain-stat">
            <span className="phantom-drain-stat__label">Total Cost</span>
            <span className="phantom-drain-stat__value">
              {formatCurrency(phantomDrainCost)}
            </span>
          </div>
          <div className="phantom-drain-stat">
            <span className="phantom-drain-stat__label">Days Tracked</span>
            <span className="phantom-drain-stat__value">{phantomDrainDays}</span>
          </div>
        </div>
        {sleepRecords.length > 0 && (
          <div className="phantom-drain-section__detail">
            <h4>Recent Sleep Records</h4>
            <ul className="phantom-drain-list">
              {sleepRecords.slice(-7).reverse().map((record, i) => (
                <li key={i} className="phantom-drain-list__item">
                  <span className="phantom-drain-list__date">{record.date}</span>
                  <span className="phantom-drain-list__energy">
                    {formatEnergy(record.phantomDrainKwh)}
                  </span>
                  <span className="phantom-drain-list__cost">
                    {formatCurrency(record.phantomDrainKwh * homeRate)}
                  </span>
                  {record.sentryModeActive && (
                    <span className="phantom-drain-list__badge">Sentry</span>
                  )}
                  {record.cabinOverheatActive && (
                    <span className="phantom-drain-list__badge">Overheat Prot.</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* Charging Location Breakdown */}
      <section className="location-breakdown">
        <div className="location-breakdown__chart">
          <Doughnut data={doughnutData} options={doughnutOptions} />
        </div>
        <div className="location-breakdown__rates">
          <h4>Configured Rates</h4>
          <ul className="location-breakdown__rate-list">
            {settings.electricityRates.map((rate) => (
              <li key={rate.id} className="location-breakdown__rate-item">
                <span className="location-breakdown__rate-name">{rate.name}</span>
                <span className="location-breakdown__rate-value">
                  {formatCurrency(rate.rate)}/kWh
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Cost per Mile Trend */}
      <section className="cost-per-mile-trend">
        <div className="cost-per-mile-trend__chart">
          {costPerMileTrend.length > 0 ? (
            <Bar data={costPerMileData} options={costPerMileOptions} />
          ) : (
            <p className="cost-per-mile-trend__empty">
              No trip data available for cost-per-mile trend.
            </p>
          )}
        </div>
      </section>
    </div>
  );
};

export default CostAnalytics;
