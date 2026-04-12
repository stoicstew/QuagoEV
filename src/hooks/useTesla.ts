import { useState, useEffect, useCallback } from 'react';

interface Vehicle {
  id: number;
  vehicle_id: number;
  vin: string;
  display_name: string;
  state: string;
}

interface VehicleData {
  charge_state: {
    battery_level: number;
    battery_range: number;
    charge_limit_soc: number;
    charge_rate: number;
    charging_state: string;
    est_battery_range: number;
    ideal_battery_range: number;
    usable_battery_level: number;
    charge_energy_added: number;
    charge_miles_added_rated: number;
    time_to_full_charge: number;
    charger_power: number;
    charge_current_request: number;
    charger_voltage: number;
    battery_heater_on: boolean;
  };
  climate_state: {
    inside_temp: number;
    outside_temp: number;
    driver_temp_setting: number;
    is_climate_on: boolean;
    fan_status: number;
    seat_heater_left: number;
    seat_heater_right: number;
  };
  drive_state: {
    speed: number | null;
    power: number;
    latitude: number;
    longitude: number;
    heading: number;
    gps_as_of: number;
  };
  vehicle_state: {
    odometer: number;
    car_version: string;
    locked: boolean;
    sentry_mode: boolean;
    fd_window: number;
    fp_window: number;
    rd_window: number;
    rp_window: number;
    ft: number;
    rt: number;
    tpms_pressure_fl: number;
    tpms_pressure_fr: number;
    tpms_pressure_rl: number;
    tpms_pressure_rr: number;
  };
  vehicle_config: {
    car_type: string;
    exterior_color: string;
    trim_badging: string;
    wheel_type: string;
  };
  gui_settings: {
    gui_distance_units: string;
    gui_temperature_units: string;
    gui_charge_rate_units: string;
  };
}

const apiFetch = async (path: string, options?: RequestInit) => {
  const res = await fetch(path, { credentials: 'include', ...options });
  if (res.status === 401) {
    // Try refresh
    const refreshRes = await fetch('/auth/refresh', { method: 'POST', credentials: 'include' });
    if (refreshRes.ok) {
      return fetch(path, { credentials: 'include', ...options }).then((r) => r.json());
    }
    throw new Error('Session expired');
  }
  return res.json();
};

export function useVehicles() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/vehicles');
      setVehicles(data.response || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vehicles');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { vehicles, loading, error, refresh };
}

export function useVehicleData(vehicleId: number | null) {
  const [data, setData] = useState<VehicleData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    try {
      const result = await apiFetch(`/api/vehicles/${vehicleId}/data`);
      setData(result.response || null);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load vehicle data');
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    refresh();
    // Auto-refresh every 30 seconds
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  return { data, loading, error, refresh };
}

export function useVehicleCommand(vehicleId: number | null) {
  const [sending, setSending] = useState(false);

  const sendCommand = useCallback(
    async (command: string, body?: Record<string, unknown>) => {
      if (!vehicleId) return null;
      setSending(true);
      try {
        const result = await apiFetch(`/api/vehicles/${vehicleId}/command/${command}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined,
        });
        return result;
      } finally {
        setSending(false);
      }
    },
    [vehicleId]
  );

  const wakeUp = useCallback(async () => {
    if (!vehicleId) return null;
    return apiFetch(`/api/vehicles/${vehicleId}/wake`, { method: 'POST' });
  }, [vehicleId]);

  return { sendCommand, wakeUp, sending };
}

export type { Vehicle, VehicleData };
