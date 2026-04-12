import { useState } from 'react';
import { getSettings, saveSettings, type AppSettings, type ElectricityRate } from '../utils/storage';

function generateId(): string {
  return `rate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY', 'INR', 'MXN', 'BRL'];

export default function Settings() {
  const [settings, setSettings] = useState<AppSettings>(getSettings);
  const [saved, setSaved] = useState(false);
  const [confirmAction, setConfirmAction] = useState<string | null>(null);

  function update(patch: Partial<AppSettings>) {
    setSettings((prev) => ({ ...prev, ...patch }));
    setSaved(false);
  }

  function updateRate(id: string, patch: Partial<ElectricityRate>) {
    update({
      electricityRates: settings.electricityRates.map((r) =>
        r.id === id ? { ...r, ...patch } : r
      ),
    });
  }

  function addTouRate(rateId: string) {
    update({
      electricityRates: settings.electricityRates.map((r) => {
        if (r.id !== rateId) return r;
        const existing = r.touRates ?? [];
        return {
          ...r,
          touRates: [...existing, { startHour: 0, endHour: 6, rate: r.rate * 0.5 }],
        };
      }),
    });
  }

  function updateTouRate(
    rateId: string,
    touIndex: number,
    patch: Partial<{ startHour: number; endHour: number; rate: number }>
  ) {
    update({
      electricityRates: settings.electricityRates.map((r) => {
        if (r.id !== rateId || !r.touRates) return r;
        return {
          ...r,
          touRates: r.touRates.map((t, i) => (i === touIndex ? { ...t, ...patch } : t)),
        };
      }),
    });
  }

  function removeTouRate(rateId: string, touIndex: number) {
    update({
      electricityRates: settings.electricityRates.map((r) => {
        if (r.id !== rateId || !r.touRates) return r;
        const updated = r.touRates.filter((_, i) => i !== touIndex);
        return { ...r, touRates: updated.length > 0 ? updated : undefined };
      }),
    });
  }

  function addCustomLocation() {
    const newRate: ElectricityRate = {
      id: generateId(),
      name: 'Custom',
      location: 'public',
      rate: 0.15,
    };
    update({ electricityRates: [...settings.electricityRates, newRate] });
  }

  function removeRate(id: string) {
    update({ electricityRates: settings.electricityRates.filter((r) => r.id !== id) });
  }

  function handleSave() {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function exportAllData() {
    const allData: Record<string, unknown> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('quagoev_')) {
        try {
          allData[key] = JSON.parse(localStorage.getItem(key) ?? '');
        } catch {
          allData[key] = localStorage.getItem(key);
        }
      }
    }
    const blob = new Blob([JSON.stringify(allData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `quagoev-export-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearTripHistory() {
    localStorage.removeItem('quagoev_trip_history');
    setConfirmAction(null);
  }

  function clearBatterySnapshots() {
    localStorage.removeItem('quagoev_battery_snapshots');
    setConfirmAction(null);
  }

  function resetToDefaults() {
    localStorage.removeItem('quagoev_settings');
    setSettings(getSettings());
    setConfirmAction(null);
  }

  function formatHour(h: number): string {
    if (h === 0 || h === 24) return '12 AM';
    if (h === 12) return '12 PM';
    return h < 12 ? `${h} AM` : `${h - 12} PM`;
  }

  return (
    <div className="settings">
      <h1 className="settings-title">Settings</h1>

      {/* Electricity Rates */}
      <section className="settings-section">
        <h2 className="settings-section-title">Electricity Rates</h2>
        <p className="settings-section-description">
          Configure your charging costs at different locations.
        </p>

        <div className="rate-list">
          {settings.electricityRates.map((rate) => (
            <div key={rate.id} className="rate-card">
              <div className="rate-card-header">
                <div className="rate-form">
                  <label className="rate-field">
                    <span className="rate-field-label">Name</span>
                    <input
                      type="text"
                      className="rate-input"
                      value={rate.name}
                      onChange={(e) => updateRate(rate.id, { name: e.target.value })}
                    />
                  </label>
                  <label className="rate-field">
                    <span className="rate-field-label">Location Type</span>
                    <select
                      className="rate-select"
                      value={rate.location}
                      onChange={(e) =>
                        updateRate(rate.id, {
                          location: e.target.value as 'home' | 'work' | 'public',
                        })
                      }
                    >
                      <option value="home">Home</option>
                      <option value="work">Work</option>
                      <option value="public">Public</option>
                    </select>
                  </label>
                  <label className="rate-field">
                    <span className="rate-field-label">Rate ($/kWh)</span>
                    <input
                      type="number"
                      className="rate-input rate-input-number"
                      step="0.01"
                      min="0"
                      value={rate.rate}
                      onChange={(e) =>
                        updateRate(rate.id, { rate: parseFloat(e.target.value) || 0 })
                      }
                    />
                  </label>
                </div>
                {!['home', 'work'].includes(rate.id) && (
                  <button
                    className="rate-remove-btn"
                    onClick={() => removeRate(rate.id)}
                    title="Remove location"
                  >
                    Remove
                  </button>
                )}
              </div>

              {/* Time-of-Use Rates */}
              <div className="tou-section">
                {rate.touRates && rate.touRates.length > 0 && (
                  <div className="tou-list">
                    <span className="tou-label">Time-of-Use Rates</span>
                    {rate.touRates.map((tou, idx) => (
                      <div key={idx} className="tou-row">
                        <label className="tou-field">
                          <span className="tou-field-label">From</span>
                          <select
                            className="tou-select"
                            value={tou.startHour}
                            onChange={(e) =>
                              updateTouRate(rate.id, idx, {
                                startHour: parseInt(e.target.value, 10),
                              })
                            }
                          >
                            {Array.from({ length: 24 }, (_, h) => (
                              <option key={h} value={h}>
                                {formatHour(h)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="tou-field">
                          <span className="tou-field-label">To</span>
                          <select
                            className="tou-select"
                            value={tou.endHour}
                            onChange={(e) =>
                              updateTouRate(rate.id, idx, {
                                endHour: parseInt(e.target.value, 10),
                              })
                            }
                          >
                            {Array.from({ length: 24 }, (_, h) => (
                              <option key={h + 1} value={h + 1}>
                                {formatHour(h + 1)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="tou-field">
                          <span className="tou-field-label">$/kWh</span>
                          <input
                            type="number"
                            className="tou-input"
                            step="0.01"
                            min="0"
                            value={tou.rate}
                            onChange={(e) =>
                              updateTouRate(rate.id, idx, {
                                rate: parseFloat(e.target.value) || 0,
                              })
                            }
                          />
                        </label>
                        <button
                          className="tou-remove-btn"
                          onClick={() => removeTouRate(rate.id, idx)}
                          title="Remove TOU rate"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button className="tou-add-btn" onClick={() => addTouRate(rate.id)}>
                  + Add Time-of-Use Rate
                </button>
              </div>
            </div>
          ))}
        </div>

        <button className="add-location-btn" onClick={addCustomLocation}>
          + Add Custom Location
        </button>
      </section>

      {/* Gas Comparison */}
      <section className="settings-section">
        <h2 className="settings-section-title">Gas Comparison</h2>
        <p className="settings-section-description">
          Set gas vehicle parameters to compare EV savings.
        </p>

        <div className="comparison-form">
          <label className="comparison-field">
            <span className="comparison-field-label">Gas Price per Gallon ($)</span>
            <input
              type="number"
              className="comparison-input"
              step="0.01"
              min="0"
              value={settings.gasPricePerGallon}
              onChange={(e) =>
                update({ gasPricePerGallon: parseFloat(e.target.value) || 0 })
              }
            />
          </label>
          <label className="comparison-field">
            <span className="comparison-field-label">Comparison Vehicle MPG</span>
            <input
              type="number"
              className="comparison-input"
              step="1"
              min="1"
              value={settings.gasCarMpg}
              onChange={(e) =>
                update({ gasCarMpg: parseFloat(e.target.value) || 1 })
              }
            />
          </label>
        </div>
      </section>

      {/* Display Preferences */}
      <section className="settings-section">
        <h2 className="settings-section-title">Display Preferences</h2>

        <div className="preferences-form">
          <div className="preference-toggle">
            <span className="preference-label">Distance Unit</span>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${settings.distanceUnit === 'mi' ? 'toggle-btn-active' : ''}`}
                onClick={() => update({ distanceUnit: 'mi' })}
              >
                Miles
              </button>
              <button
                className={`toggle-btn ${settings.distanceUnit === 'km' ? 'toggle-btn-active' : ''}`}
                onClick={() => update({ distanceUnit: 'km' })}
              >
                Kilometers
              </button>
            </div>
          </div>

          <div className="preference-toggle">
            <span className="preference-label">Temperature Unit</span>
            <div className="toggle-group">
              <button
                className={`toggle-btn ${settings.tempUnit === 'F' ? 'toggle-btn-active' : ''}`}
                onClick={() => update({ tempUnit: 'F' })}
              >
                Fahrenheit
              </button>
              <button
                className={`toggle-btn ${settings.tempUnit === 'C' ? 'toggle-btn-active' : ''}`}
                onClick={() => update({ tempUnit: 'C' })}
              >
                Celsius
              </button>
            </div>
          </div>

          <label className="preference-field">
            <span className="preference-label">Currency</span>
            <select
              className="preference-select"
              value={settings.currency}
              onChange={(e) => update({ currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {/* Data Management */}
      <section className="settings-section">
        <h2 className="settings-section-title">Data Management</h2>

        <div className="data-actions">
          <button className="data-btn data-btn-export" onClick={exportAllData}>
            Export All Data
          </button>

          {confirmAction === 'trips' ? (
            <div className="confirm-row">
              <span className="confirm-text">Clear all trip history?</span>
              <button className="confirm-btn confirm-btn-yes" onClick={clearTripHistory}>
                Confirm
              </button>
              <button className="confirm-btn confirm-btn-no" onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="data-btn data-btn-danger"
              onClick={() => setConfirmAction('trips')}
            >
              Clear Trip History
            </button>
          )}

          {confirmAction === 'battery' ? (
            <div className="confirm-row">
              <span className="confirm-text">Clear all battery snapshots?</span>
              <button className="confirm-btn confirm-btn-yes" onClick={clearBatterySnapshots}>
                Confirm
              </button>
              <button className="confirm-btn confirm-btn-no" onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="data-btn data-btn-danger"
              onClick={() => setConfirmAction('battery')}
            >
              Clear Battery Snapshots
            </button>
          )}

          {confirmAction === 'reset' ? (
            <div className="confirm-row">
              <span className="confirm-text">Reset all settings to defaults?</span>
              <button className="confirm-btn confirm-btn-yes" onClick={resetToDefaults}>
                Confirm
              </button>
              <button className="confirm-btn confirm-btn-no" onClick={() => setConfirmAction(null)}>
                Cancel
              </button>
            </div>
          ) : (
            <button
              className="data-btn data-btn-danger"
              onClick={() => setConfirmAction('reset')}
            >
              Reset to Defaults
            </button>
          )}
        </div>
      </section>

      {/* Save */}
      <div className="settings-save-bar">
        <button className="save-btn" onClick={handleSave}>
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
