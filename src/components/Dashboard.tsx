import { useState, useEffect, useCallback } from 'react';
import {
  useVehicles,
  useVehicleData,
  useVehicleCommand,
} from '../hooks/useTesla';
import type { Vehicle, VehicleData } from '../hooks/useTesla';
import {
  formatTemp,
  formatDistance,
  formatPercent,
  formatEnergy,
  timeAgo,
} from '../utils/format';
import { addBatterySnapshot } from '../utils/storage';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Friendly model name from the raw car_type string */
function modelDisplayName(carType: string): string {
  const map: Record<string, string> = {
    models: 'Model S',
    modelx: 'Model X',
    model3: 'Model 3',
    modely: 'Model Y',
  };
  const key = carType.toLowerCase().replace(/[\s_-]/g, '');
  return map[key] ?? carType;
}

/** Returns true when any window is open */
function anyWindowOpen(vs: VehicleData['vehicle_state']): boolean {
  return (
    vs.fd_window !== 0 ||
    vs.fp_window !== 0 ||
    vs.rd_window !== 0 ||
    vs.rp_window !== 0
  );
}

/** Human-readable charging state */
function chargingLabel(state: string): string {
  const labels: Record<string, string> = {
    Charging: 'Charging',
    Complete: 'Charge Complete',
    Disconnected: 'Unplugged',
    Stopped: 'Charging Stopped',
    NoPower: 'Waiting for Power',
    Starting: 'Starting to Charge',
  };
  return labels[state] ?? state;
}

/** PSI display value – Tesla reports bar, convert to psi for US units */
function formatPsi(bar: number): string {
  const psi = bar * 14.5038;
  return `${psi.toFixed(1)}`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function VehicleSelector({
  vehicles,
  selectedId,
  onSelect,
}: {
  vehicles: Vehicle[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  if (vehicles.length <= 1) return null;

  return (
    <div className="vehicle-selector">
      <label htmlFor="vehicle-select" className="vehicle-selector-label">
        Vehicle
      </label>
      <select
        id="vehicle-select"
        className="vehicle-selector-dropdown"
        value={selectedId ?? ''}
        onChange={(e) => onSelect(Number(e.target.value))}
      >
        {vehicles.map((v) => (
          <option key={v.id} value={v.id}>
            {v.display_name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------

function BatteryGauge({
  level,
  limit,
  charging,
}: {
  level: number;
  limit: number;
  charging: boolean;
}) {
  const radius = 70;
  const stroke = 10;
  const normalizedRadius = radius - stroke / 2;
  const circumference = 2 * Math.PI * normalizedRadius;
  const levelOffset = circumference - (level / 100) * circumference;
  const limitOffset = circumference - (limit / 100) * circumference;

  // Color based on level
  let gaugeColor = 'var(--color-success)';
  if (level <= 10) gaugeColor = 'var(--color-danger)';
  else if (level <= 20) gaugeColor = 'var(--color-warning)';

  return (
    <div className="battery-gauge">
      <svg
        className="battery-gauge-svg"
        width={radius * 2}
        height={radius * 2}
        viewBox={`0 0 ${radius * 2} ${radius * 2}`}
      >
        {/* Background track */}
        <circle
          className="battery-gauge-track"
          cx={radius}
          cy={radius}
          r={normalizedRadius}
          fill="none"
          strokeWidth={stroke}
        />
        {/* Charge limit marker */}
        <circle
          className="battery-gauge-limit"
          cx={radius}
          cy={radius}
          r={normalizedRadius}
          fill="none"
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={limitOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${radius} ${radius})`}
          opacity={0.2}
        />
        {/* Active level */}
        <circle
          className="battery-gauge-level"
          cx={radius}
          cy={radius}
          r={normalizedRadius}
          fill="none"
          stroke={gaugeColor}
          strokeWidth={stroke}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={levelOffset}
          strokeLinecap="round"
          transform={`rotate(-90 ${radius} ${radius})`}
        />
      </svg>
      <div className="battery-gauge-text">
        <span className="battery-gauge-value">{Math.round(level)}</span>
        <span className="battery-gauge-unit">%</span>
        {charging && <span className="battery-gauge-charging-icon" />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function HeroCard({ vehicle, data }: { vehicle: Vehicle; data: VehicleData }) {
  const { charge_state, vehicle_config, gui_settings } = data;
  const isCharging = charge_state.charging_state === 'Charging';

  return (
    <section className="hero-card">
      <div className="hero-card-header">
        <div className="hero-card-titles">
          <h1 className="hero-card-name">{vehicle.display_name}</h1>
          <p className="hero-card-model">
            {modelDisplayName(vehicle_config.car_type)}
            {vehicle_config.trim_badging && (
              <span className="hero-card-trim">
                {' '}
                {vehicle_config.trim_badging}
              </span>
            )}
          </p>
        </div>
        <span className={`vehicle-state-badge ${vehicle.state}`}>
          {vehicle.state}
        </span>
      </div>

      <div className="hero-card-body">
        <BatteryGauge
          level={charge_state.battery_level}
          limit={charge_state.charge_limit_soc}
          charging={isCharging}
        />

        <div className="hero-card-info">
          <div className="hero-card-charge-status">
            <span
              className={`charge-state-indicator ${isCharging ? 'charging' : ''}`}
            />
            <span className="charge-state-label">
              {chargingLabel(charge_state.charging_state)}
            </span>
          </div>

          <div className="hero-card-range">
            <span className="range-value">
              {formatDistance(
                charge_state.est_battery_range,
                gui_settings.gui_distance_units
              )}
            </span>
            <span className="range-label">Estimated Range</span>
          </div>

          {isCharging && (
            <div className="hero-card-charging-details">
              <div className="charging-detail">
                <span className="charging-detail-label">Rate</span>
                <span className="charging-detail-value">
                  {charge_state.charge_rate > 0
                    ? `${charge_state.charge_rate} mph`
                    : '--'}
                </span>
              </div>
              <div className="charging-detail">
                <span className="charging-detail-label">Power</span>
                <span className="charging-detail-value">
                  {charge_state.charger_power > 0
                    ? `${charge_state.charger_power} kW`
                    : '--'}
                </span>
              </div>
              <div className="charging-detail">
                <span className="charging-detail-label">Time Left</span>
                <span className="charging-detail-value">
                  {charge_state.time_to_full_charge > 0
                    ? `${charge_state.time_to_full_charge.toFixed(1)}h`
                    : '--'}
                </span>
              </div>
              <div className="charging-detail">
                <span className="charging-detail-label">Added</span>
                <span className="charging-detail-value">
                  {formatEnergy(charge_state.charge_energy_added)}
                </span>
              </div>
            </div>
          )}

          <div className="hero-card-charge-limit">
            Charge Limit: {formatPercent(charge_state.charge_limit_soc)}
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function QuickStatsGrid({ data }: { data: VehicleData }) {
  const { vehicle_state, climate_state, gui_settings } = data;
  const tempUnit = gui_settings.gui_temperature_units === 'C' ? 'C' : 'F';

  return (
    <section className="quick-stats">
      <h2 className="section-title">Quick Stats</h2>
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-card-icon">&#x1F6E3;</span>
          <span className="stat-card-label">Odometer</span>
          <span className="stat-card-value">
            {formatDistance(vehicle_state.odometer, gui_settings.gui_distance_units)}
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-card-icon">&#x1F321;</span>
          <span className="stat-card-label">Inside Temp</span>
          <span className="stat-card-value">
            {climate_state.inside_temp != null
              ? formatTemp(climate_state.inside_temp, tempUnit)
              : '--'}
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-card-icon">&#x26C5;</span>
          <span className="stat-card-label">Outside Temp</span>
          <span className="stat-card-value">
            {climate_state.outside_temp != null
              ? formatTemp(climate_state.outside_temp, tempUnit)
              : '--'}
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-card-icon">&#x1F6DE;</span>
          <span className="stat-card-label">Tire Pressure</span>
          <span className="stat-card-value stat-card-value--tires">
            <span className="tire-grid">
              <span className="tire" title="Front Left">
                FL {formatPsi(vehicle_state.tpms_pressure_fl)}
              </span>
              <span className="tire" title="Front Right">
                FR {formatPsi(vehicle_state.tpms_pressure_fr)}
              </span>
              <span className="tire" title="Rear Left">
                RL {formatPsi(vehicle_state.tpms_pressure_rl)}
              </span>
              <span className="tire" title="Rear Right">
                RR {formatPsi(vehicle_state.tpms_pressure_rr)}
              </span>
            </span>
          </span>
        </div>

        <div className="stat-card">
          <span className="stat-card-icon">&#x1F4E6;</span>
          <span className="stat-card-label">Software</span>
          <span className="stat-card-value stat-card-value--mono">
            {vehicle_state.car_version.split(' ')[0]}
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function LiveStatusCards({ data }: { data: VehicleData }) {
  const { vehicle_state, climate_state } = data;
  const windowsOpen = anyWindowOpen(vehicle_state);

  return (
    <section className="live-status">
      <h2 className="section-title">Live Status</h2>
      <div className="status-grid">
        <div
          className={`status-card ${vehicle_state.locked ? 'status-card--ok' : 'status-card--warn'}`}
        >
          <span className="status-card-icon">
            {vehicle_state.locked ? '\u{1F512}' : '\u{1F513}'}
          </span>
          <span className="status-card-label">
            {vehicle_state.locked ? 'Locked' : 'Unlocked'}
          </span>
        </div>

        <div
          className={`status-card ${vehicle_state.sentry_mode ? 'status-card--active' : 'status-card--off'}`}
        >
          <span className="status-card-icon">
            {vehicle_state.sentry_mode ? '\u{1F6E1}' : '\u{1F6E1}'}
          </span>
          <span className="status-card-label">
            Sentry {vehicle_state.sentry_mode ? 'On' : 'Off'}
          </span>
        </div>

        <div
          className={`status-card ${climate_state.is_climate_on ? 'status-card--active' : 'status-card--off'}`}
        >
          <span className="status-card-icon">
            {climate_state.is_climate_on ? '\u{2744}' : '\u{1F321}'}
          </span>
          <span className="status-card-label">
            Climate {climate_state.is_climate_on ? 'On' : 'Off'}
          </span>
          {climate_state.is_climate_on && (
            <span className="status-card-detail">
              Set to {formatTemp(climate_state.driver_temp_setting, 'F')}
            </span>
          )}
        </div>

        <div
          className={`status-card ${windowsOpen ? 'status-card--warn' : 'status-card--ok'}`}
        >
          <span className="status-card-icon">
            {windowsOpen ? '\u{1FA9F}' : '\u{1FA9F}'}
          </span>
          <span className="status-card-label">
            Windows {windowsOpen ? 'Open' : 'Closed'}
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------

function QuickActions({
  data,
  sendCommand,
  wakeUp,
  sending,
  onCommandSuccess,
}: {
  data: VehicleData;
  sendCommand: (cmd: string, body?: Record<string, unknown>) => Promise<unknown>;
  wakeUp: () => Promise<unknown>;
  sending: boolean;
  onCommandSuccess: () => void;
}) {
  const { vehicle_state, climate_state } = data;

  const exec = useCallback(
    async (cmd: string, body?: Record<string, unknown>) => {
      await sendCommand(cmd, body);
      // Give the car a moment to process, then refresh data
      setTimeout(onCommandSuccess, 2000);
    },
    [sendCommand, onCommandSuccess]
  );

  return (
    <section className="quick-actions">
      <h2 className="section-title">Quick Actions</h2>
      <div className="actions-grid">
        <button
          className={`action-btn ${vehicle_state.locked ? 'action-btn--lock' : 'action-btn--unlock'}`}
          disabled={sending}
          onClick={() =>
            exec(vehicle_state.locked ? 'door_unlock' : 'door_lock')
          }
        >
          <span className="action-btn-icon">
            {vehicle_state.locked ? '\u{1F513}' : '\u{1F512}'}
          </span>
          <span className="action-btn-label">
            {vehicle_state.locked ? 'Unlock' : 'Lock'}
          </span>
        </button>

        <button
          className={`action-btn ${climate_state.is_climate_on ? 'action-btn--active' : ''}`}
          disabled={sending}
          onClick={() =>
            exec(
              climate_state.is_climate_on
                ? 'auto_conditioning_stop'
                : 'auto_conditioning_start'
            )
          }
        >
          <span className="action-btn-icon">{'\u{2744}'}</span>
          <span className="action-btn-label">
            Climate {climate_state.is_climate_on ? 'Off' : 'On'}
          </span>
        </button>

        <button
          className="action-btn"
          disabled={sending}
          onClick={() => exec('actuate_trunk', { which_trunk: 'front' })}
        >
          <span className="action-btn-icon">{'\u{1F4E6}'}</span>
          <span className="action-btn-label">Frunk</span>
        </button>

        <button
          className="action-btn"
          disabled={sending}
          onClick={() => exec('actuate_trunk', { which_trunk: 'rear' })}
        >
          <span className="action-btn-icon">{'\u{1F6D7}'}</span>
          <span className="action-btn-label">Trunk</span>
        </button>

        <button
          className="action-btn"
          disabled={sending}
          onClick={() => exec('flash_lights')}
        >
          <span className="action-btn-icon">{'\u{1F4A1}'}</span>
          <span className="action-btn-label">Flash Lights</span>
        </button>

        <button
          className="action-btn"
          disabled={sending}
          onClick={() => exec('honk_horn')}
        >
          <span className="action-btn-icon">{'\u{1F4E2}'}</span>
          <span className="action-btn-label">Honk Horn</span>
        </button>

        <button
          className="action-btn action-btn--wake"
          disabled={sending}
          onClick={async () => {
            await wakeUp();
            setTimeout(onCommandSuccess, 5000);
          }}
        >
          <span className="action-btn-icon">{'\u{26A1}'}</span>
          <span className="action-btn-label">Wake Up</span>
        </button>
      </div>

      {sending && (
        <div className="actions-sending">
          <span className="spinner" />
          <span>Sending command...</span>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const {
    vehicles,
    loading: vehiclesLoading,
    error: vehiclesError,
    refresh: refreshVehicles,
  } = useVehicles();

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Auto-select first vehicle when list loads
  useEffect(() => {
    if (vehicles.length > 0 && selectedId === null) {
      setSelectedId(vehicles[0].id);
    }
  }, [vehicles, selectedId]);

  const {
    data,
    loading: dataLoading,
    error: dataError,
    refresh: refreshData,
  } = useVehicleData(selectedId);

  const { sendCommand, wakeUp, sending } = useVehicleCommand(selectedId);

  // Track battery snapshots on every data refresh
  useEffect(() => {
    if (!data) return;

    const { charge_state, vehicle_state } = data;
    const idealRange = charge_state.ideal_battery_range;
    const batteryLevel = charge_state.battery_level;

    addBatterySnapshot({
      timestamp: Date.now(),
      odometer: vehicle_state.odometer,
      batteryLevel,
      estimatedRange: charge_state.est_battery_range,
      idealRange,
      maxRange: batteryLevel > 0 ? idealRange / (batteryLevel / 100) : 0,
    });
  }, [data]);

  const selectedVehicle = vehicles.find((v) => v.id === selectedId) ?? null;

  // ---- Loading state ----
  if (vehiclesLoading) {
    return (
      <div className="dashboard dashboard--loading">
        <div className="loading-container">
          <span className="spinner spinner--lg" />
          <p className="loading-text">Loading vehicles...</p>
        </div>
      </div>
    );
  }

  // ---- Error state ----
  if (vehiclesError) {
    return (
      <div className="dashboard dashboard--error">
        <div className="error-container">
          <h2 className="error-title">Unable to Load Vehicles</h2>
          <p className="error-message">{vehiclesError}</p>
          <button className="btn btn-primary" onClick={refreshVehicles}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  // ---- No vehicles ----
  if (vehicles.length === 0) {
    return (
      <div className="dashboard dashboard--empty">
        <div className="empty-container">
          <h2 className="empty-title">No Vehicles Found</h2>
          <p className="empty-message">
            Make sure your Tesla account is linked and you have at least one
            vehicle.
          </p>
          <button className="btn btn-primary" onClick={refreshVehicles}>
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // ---- Vehicle selected but data still loading ----
  if (!data || !selectedVehicle) {
    return (
      <div className="dashboard dashboard--loading">
        <VehicleSelector
          vehicles={vehicles}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <div className="loading-container">
          <span className="spinner spinner--lg" />
          <p className="loading-text">
            {dataLoading
              ? 'Fetching vehicle data...'
              : 'Select a vehicle to continue.'}
          </p>
        </div>
      </div>
    );
  }

  // ---- Data error (but we have a vehicle) ----
  if (dataError && !data) {
    return (
      <div className="dashboard dashboard--error">
        <VehicleSelector
          vehicles={vehicles}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <div className="error-container">
          <h2 className="error-title">Unable to Load Vehicle Data</h2>
          <p className="error-message">{dataError}</p>
          <p className="error-hint">
            The vehicle may be asleep. Try waking it up first.
          </p>
          <div className="error-actions">
            <button className="btn btn-primary" onClick={refreshData}>
              Retry
            </button>
            <button
              className="btn btn-secondary"
              disabled={sending}
              onClick={async () => {
                await wakeUp();
                setTimeout(refreshData, 5000);
              }}
            >
              Wake Up &amp; Retry
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- Full dashboard ----
  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <VehicleSelector
          vehicles={vehicles}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <div className="dashboard-header-actions">
          {data.drive_state.gps_as_of > 0 && (
            <span className="last-seen" title="Last data update from vehicle">
              Updated {timeAgo(data.drive_state.gps_as_of)}
            </span>
          )}
          <button
            className="btn btn-ghost btn-sm refresh-btn"
            onClick={refreshData}
            disabled={dataLoading}
            aria-label="Refresh vehicle data"
          >
            <span className={`refresh-icon ${dataLoading ? 'spinning' : ''}`}>
              &#x21BB;
            </span>
          </button>
        </div>
      </header>

      <HeroCard vehicle={selectedVehicle} data={data} />

      <QuickStatsGrid data={data} />

      <LiveStatusCards data={data} />

      <QuickActions
        data={data}
        sendCommand={sendCommand}
        wakeUp={wakeUp}
        sending={sending}
        onCommandSuccess={refreshData}
      />
    </div>
  );
}
