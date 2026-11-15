import { useMemo, type ReactNode } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import { Chart, registerables, type ChartOptions } from 'chart.js';
import { date, dayKey, number } from '../data/format';
import type { Trip } from '../data/types';
Chart.register(...registerables);

export type IconName = 'overview' | 'drives' | 'charging' | 'battery' | 'insights' | 'settings' | 'refresh' | 'cloud' | 'download' | 'arrow' | 'check' | 'close' | 'bolt' | 'offline';
const paths: Record<IconName, string> = {
  overview: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  drives: 'M5 5a2 2 0 1 0 0 .1M19 19a2 2 0 1 0 0 .1M7 5h7a4 4 0 0 1 0 8H10a3 3 0 0 0 0 6h7',
  charging: 'M8 2v5M16 2v5M6 7h12v4a6 6 0 0 1-6 6v5M6 7v4a6 6 0 0 0 6 6',
  battery: 'M3 7h16v10H3zM22 10v4M7 10v4M11 10v4',
  insights: 'M4 3v17h17M8 15l4-5 4 2 5-7',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z',
  refresh: 'M20 7a9 9 0 0 0-15-2L2 8M2 3v5h5M4 17a9 9 0 0 0 15 2l3-3M22 21v-5h-5',
  cloud: 'M6 18a5 5 0 0 1-1-10 7 7 0 0 1 13-1 5.5 5.5 0 0 1 0 11z',
  download: 'M12 3v12M7 10l5 5 5-5M4 16v5h16v-5',
  arrow: 'M5 12h14M14 7l5 5-5 5',
  check: 'M4 12l5 5L20 6',
  close: 'M6 6l12 12M6 18L18 6',
  bolt: 'M13 2L4 14h7l-1 8 10-13h-7z',
  offline: 'M3 3l18 18M5 17a5 5 0 0 1-1-9M9 5a7 7 0 0 1 10 3 5 5 0 0 1 2 9M8 18h8',
};
export function Icon({ name, size = 20 }: { name: IconName; size?: number }) { return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>; }
export function Metric({ label, value, unit, detail, icon }: { label: string; value: ReactNode; unit?: string; detail?: ReactNode; icon?: IconName }) { return <div className="metric"><div className="metric-label">{label}{icon && <Icon name={icon} size={17} />}</div><div className="metric-value">{value}<span>{unit}</span></div>{detail && <div className="metric-detail">{detail}</div>}</div>; }
export function Panel({ title, subtitle, action, children, className = '' }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode; className?: string }) { return <section className={`panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action}</div>{children}</section>; }
export function Empty({ title, description, icon = 'insights', action }: { title: string; description: string; icon?: IconName; action?: ReactNode }) { return <div className="empty"><span className="empty-icon"><Icon name={icon} size={25} /></span><h3>{title}</h3><p>{description}</p>{action}</div>; }
const baseOptions = {
  responsive: true, maintainAspectRatio: false,
  animation: false as const,
  interaction: { intersect: false, mode: 'index' as const },
  plugins: { legend: { display: false }, tooltip: { backgroundColor: '#182c2c', padding: 12, displayColors: false } },
  scales: { x: { grid: { display: false }, border: { display: false }, ticks: { color: '#718080', font: { size: 11 }, maxRotation: 0, maxTicksLimit: 7 } }, y: { grid: { color: '#e7edeb' }, border: { display: false }, ticks: { color: '#718080', font: { size: 11 }, maxTicksLimit: 5 } } },
};
export function DistanceChart({ trips, timeZone }: { trips: Trip[]; timeZone: string }) {
  const values = useMemo(() => {
    const map = new Map<string, { total: number; timestamp: number }>();
    for (const t of trips) { const key = dayKey(t.startTime, timeZone); const old = map.get(key); map.set(key, { total: (old?.total ?? 0) + t.distanceKm, timestamp: t.startTime }); }
    return [...map].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v);
  }, [trips, timeZone]);
  if (!values.length) return <Empty title="Your driving story starts here" description="Recorded drives will appear here after your collector receives vehicle data." icon="drives" />;
  const options: ChartOptions<'bar'> = { ...baseOptions, plugins: { ...baseOptions.plugins, tooltip: { ...baseOptions.plugins?.tooltip, callbacks: { label: item => `${number(item.parsed.y)} km` } } }, scales: { ...baseOptions.scales, y: { ...baseOptions.scales?.y, beginAtZero: true, title: { display: true, text: 'Distance · km', color: '#718080', font: { size: 11 } } } } };
  return <div className="chart"><Bar aria-label="Distance driven on days with recorded trips, in kilometres" role="img" options={options} data={{ labels: values.map(v => date(v.timestamp, timeZone)), datasets: [{ data: values.map(v => v.total), backgroundColor: '#379888', hoverBackgroundColor: '#237b6d', borderRadius: 5, maxBarThickness: 34 }] }} /></div>;
}
export function TrendChart({ points, timeZone, label }: { points: Array<{ timestamp: number; value: number }>; timeZone: string; label: string }) {
  if (!points.length) return <Empty title="No measurements in this period" description="New readings will appear after collection starts. Try selecting all history." icon="battery" />;
  const sorted = [...points].sort((a, b) => a.timestamp - b.timestamp);
  const options: ChartOptions<'line'> = { ...baseOptions, plugins: { ...baseOptions.plugins, tooltip: { ...baseOptions.plugins?.tooltip, callbacks: { title: items => items.length ? date(items[0].parsed.x ?? 0, timeZone, { year: 'numeric' }) : '', label: item => `${number(item.parsed.y)} ${label}` } } }, scales: { ...baseOptions.scales, x: { ...baseOptions.scales?.x, type: 'linear', ticks: { ...baseOptions.scales?.x?.ticks, callback: value => date(Number(value), timeZone) } }, y: { ...baseOptions.scales?.y, title: { display: true, text: label, color: '#718080', font: { size: 11 } } } } };
  return <div className="chart"><Line aria-label={`${label} over time, using recorded measurements`} role="img" options={options} data={{ datasets: [{ data: sorted.map(p => ({ x: p.timestamp, y: p.value })), borderColor: '#278b7b', backgroundColor: 'rgba(39,139,123,.07)', fill: true, tension: .15, pointRadius: sorted.length < 40 ? 3 : 0, pointHoverRadius: 5, borderWidth: 2 }] }} /></div>;
}
export function RoutePreview({ trip }: { trip: Trip }) {
  if (trip.route.length < 2) return <div className="route-empty">No recorded GPS route for this drive.</div>;
  const latitude = trip.route.reduce((sum, p) => sum + p.lat, 0) / trip.route.length;
  const scale = Math.cos(latitude * Math.PI / 180);
  const minX = Math.min(...trip.route.map(p => p.lng * scale)), maxX = Math.max(...trip.route.map(p => p.lng * scale));
  const minY = Math.min(...trip.route.map(p => p.lat)), maxY = Math.max(...trip.route.map(p => p.lat));
  const span = Math.max(maxX - minX, (maxY - minY) * 2, .00001);
  const project = (p: Trip['route'][number]) => [32 + (p.lng * scale - (minX + maxX) / 2 + span / 2) / span * 576, 140 - (p.lat - (minY + maxY) / 2) / span * 576];
  const points = trip.route.map(project);
  return <div className="route-preview"><svg viewBox="0 0 640 280" role="img" aria-label="Recorded GPS path, start marked with a solid circle and finish with an open circle"><defs><pattern id="route-grid" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="currentColor" strokeWidth=".5" /></pattern></defs><rect width="640" height="280" fill="url(#route-grid)" opacity=".25"/><polyline points={points.map(p => p.join(',')).join(' ')} fill="none" stroke="#278b7b" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round"/><circle cx={points[0][0]} cy={points[0][1]} r="6" fill="#278b7b"/><circle cx={points.at(-1)![0]} cy={points.at(-1)![1]} r="7" fill="white" stroke="#278b7b" strokeWidth="3"/></svg><span>Recorded GPS path · no map background</span></div>;
}
