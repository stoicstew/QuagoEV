export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

export function kmToMiles(km: number): number {
  return km * 0.621371;
}

export function milesToKm(mi: number): number {
  return mi * 1.60934;
}

export function psiToBar(psi: number): number {
  return psi * 0.0689476;
}

export function formatTemp(celsius: number, unit: string = 'F'): string {
  if (unit === 'C') return `${celsius.toFixed(1)}°C`;
  return `${celsiusToFahrenheit(celsius).toFixed(1)}°F`;
}

export function formatDistance(miles: number, unit: string = 'mi/hr'): string {
  if (unit === 'km/hr') return `${milesToKm(miles).toFixed(1)} km`;
  return `${miles.toFixed(1)} mi`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatEnergy(kwh: number): string {
  return `${kwh.toFixed(2)} kWh`;
}

export function formatCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function timeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() / 1000) - timestamp);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

export function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
