import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, LabelList, Legend, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useAuth } from './auth.jsx';

// Restrained blue/grey palette
export const C = { blue: '#0b5cab', blue2: '#4f8fcf', blue3: '#9cc0e6', navy: '#0b2545', grey: '#8a94a1', grey2: '#c3c9d1', grid: '#e8ebef', bad: '#b4232a' };
export const SERIES = ['#0b2545', '#0b5cab', '#4f8fcf', '#9cc0e6', '#6b7480', '#a7afba', '#2f6f8f', '#c9d6e6'];
const axis = { fontSize: 11, fill: '#6b7480' };
const tip = { contentStyle: { borderRadius: 6, border: '1px solid #dde1e6', fontSize: 12 } };

// Wrap long labels across lines on the Pareto x-axis
function WrapTick({ x, y, payload }) {
  const words = String(payload.value).split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > 13 && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) lines.push(cur);
  return (
    <g transform={`translate(${x},${y})`}>
      <text textAnchor="middle" fill="#444c57" fontSize={11}>{lines.map((l, i) => <tspan key={i} x={0} dy={i === 0 ? 12 : 13}>{l}</tspan>)}</text>
    </g>
  );
}

// Rejected parts / downtime Pareto: bars = raw count with value label, line = cumulative %
export function ParetoChart({ data, valueKey, yLabel, onSelect, selected, valueFormatter = (v) => v }) {
  if (!data?.length) return null;
  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={{ top: 22, right: 16, left: 0, bottom: 30 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="reason" tick={<WrapTick />} interval={0} height={56} tickLine={false} />
        <YAxis yAxisId="l" tick={axis} tickLine={false} axisLine={false} label={{ value: yLabel, angle: -90, position: 'insideLeft', style: { ...axis, textAnchor: 'middle' } }} />
        <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={axis} tickLine={false} axisLine={false} />
        <Tooltip {...tip} formatter={(v, n) => (n === 'Cumulative %' ? `${Number(v).toFixed(1)}%` : valueFormatter(v))} />
        <Bar yAxisId="l" dataKey={valueKey} name={yLabel} radius={[3, 3, 0, 0]} onClick={(d) => onSelect?.(d)} cursor={onSelect ? 'pointer' : 'default'}>
          {data.map((d) => <Cell key={d.id} fill={selected && selected !== d.id ? C.blue3 : C.blue} />)}
          <LabelList dataKey={valueKey} position="top" formatter={valueFormatter} style={{ fontSize: 11, fill: '#1c2530', fontWeight: 600 }} />
        </Bar>
        <Line yAxisId="r" type="monotone" dataKey="cumulative_pct" name="Cumulative %" stroke={C.navy} strokeWidth={2} dot={{ r: 3, fill: C.navy }} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

export function TrendChart({ data }) {
  const { targets } = useAuth();
  const d = data.map((r) => ({ date: r.date.slice(5), OEE: r.oee == null ? null : +(r.oee * 100).toFixed(1), Availability: r.availability == null ? null : +(r.availability * 100).toFixed(1),
    Performance: r.performance == null ? null : +(r.performance * 100).toFixed(1), Quality: r.quality == null ? null : +(r.quality * 100).toFixed(1) }));
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={d} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tick={axis} tickLine={false} minTickGap={24} />
        <YAxis domain={[50, 100]} tick={axis} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}%`} />
        <Tooltip {...tip} formatter={(v) => `${v}%`} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {targets.oee && <ReferenceLine y={targets.oee.target} stroke={C.grey} strokeDasharray="4 4" label={{ value: `OEE target ${targets.oee.target}%`, fontSize: 10, fill: C.grey, position: 'insideBottomRight' }} />}
        <Line type="monotone" dataKey="OEE" stroke={C.navy} strokeWidth={2.5} dot={false} />
        <Line type="monotone" dataKey="Availability" stroke={C.blue} strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="Performance" stroke={C.blue3} strokeWidth={1.5} dot={false} />
        <Line type="monotone" dataKey="Quality" stroke={C.grey} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Where the planned time goes: productive vs downtime / speed / quality losses (hours)
export function LossChart({ loss }) {
  if (!loss?.planned) return null;
  const h = (s) => +(s / 3600).toFixed(1);
  const data = [
    { name: 'Fully productive', hours: h(loss.productive), fill: C.blue },
    { name: 'Quality loss', hours: h(loss.quality), fill: C.blue3 },
    { name: 'Speed loss', hours: h(loss.speed), fill: C.grey },
    { name: 'Downtime', hours: h(loss.downtime), fill: C.navy },
  ];
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 40, left: 10, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" tick={axis} tickLine={false} axisLine={false} unit=" h" />
        <YAxis type="category" dataKey="name" tick={{ ...axis, fill: '#444c57' }} width={110} tickLine={false} axisLine={false} />
        <Tooltip {...tip} formatter={(v) => `${v.toLocaleString()} h`} />
        <Bar dataKey="hours" radius={[0, 3, 3, 0]}>{data.map((d) => <Cell key={d.name} fill={d.fill} />)}<LabelList dataKey="hours" position="right" style={{ fontSize: 11, fontWeight: 600 }} formatter={(v) => v.toLocaleString()} /></Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function GroupOeeChart({ data }) {
  const { targets } = useAuth();
  const d = data.map((g) => ({ name: g.name, OEE: g.oee == null ? 0 : +(g.oee * 100).toFixed(1) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, d.length * 42 + 30)}>
      <BarChart data={d} layout="vertical" margin={{ top: 4, right: 40, left: 10, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} unit="%" />
        <YAxis type="category" dataKey="name" tick={{ ...axis, fill: '#444c57' }} width={150} tickLine={false} axisLine={false} />
        <Tooltip {...tip} formatter={(v) => `${v}%`} />
        {targets.oee && <ReferenceLine x={targets.oee.target} stroke={C.grey} strokeDasharray="4 4" />}
        <Bar dataKey="OEE" fill={C.blue} radius={[0, 3, 3, 0]}><LabelList dataKey="OEE" position="right" formatter={(v) => `${v}%`} style={{ fontSize: 11, fontWeight: 600 }} /></Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// Yamazumi: one stacked bar per operator, a segment per task, takt line across
export function YamazumiChart({ operators, takt }) {
  const tasks = [];
  const rows = operators.map((o) => {
    const row = { operator: o.group === '—' ? 'Unassigned' : `Operator ${o.group}`, total: o.total };
    for (const it of o.items) { row[it.name] = it.sec; if (!tasks.includes(it.name)) tasks.push(it.name); }
    return row;
  });
  const max = Math.max(takt || 0, ...rows.map((r) => r.total)) * 1.1;
  return (
    <ResponsiveContainer width="100%" height={340}>
      <BarChart data={rows} margin={{ top: 16, right: 64, left: 0, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="operator" tick={{ ...axis, fill: '#444c57' }} tickLine={false} />
        <YAxis tick={axis} tickLine={false} axisLine={false} unit=" s" domain={[0, Math.ceil(max / 10) * 10]} />
        <Tooltip {...tip} formatter={(v, n) => [`${v} s`, n]} />
        {takt && <ReferenceLine y={takt} stroke={C.bad} strokeWidth={2} strokeDasharray="6 4" label={{ value: `Takt ${takt}s`, position: 'right', fill: C.bad, fontSize: 11 }} />}
        {tasks.map((t, i) => (
          <Bar key={t} dataKey={t} stackId="a" fill={SERIES[i % SERIES.length]} stroke="#fff">
            <LabelList dataKey={t} position="center" formatter={(v) => (v ? `${v}` : '')} style={{ fontSize: 10, fill: i % SERIES.length < 3 || i % SERIES.length === 4 ? '#fff' : '#0b2545' }} />
          </Bar>
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

// Station cycle time vs takt
export function StationChart({ operations, takt }) {
  const d = operations.map((o) => ({ name: `${o.seq}. ${o.name.split('(')[0].trim()}`, cycle: Number(o.cycle_time_sec) }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, d.length * 30 + 40)}>
      <BarChart data={d} layout="vertical" margin={{ top: 4, right: 40, left: 10, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis type="number" tick={axis} tickLine={false} axisLine={false} unit=" s" />
        <YAxis type="category" dataKey="name" tick={{ ...axis, fill: '#444c57' }} width={190} tickLine={false} axisLine={false} interval={0} />
        <Tooltip {...tip} formatter={(v) => `${v} s`} />
        {takt && <ReferenceLine x={takt} stroke={C.bad} strokeWidth={2} strokeDasharray="6 4" />}
        <Bar dataKey="cycle" radius={[0, 3, 3, 0]}>
          {d.map((x) => <Cell key={x.name} fill={takt && x.cycle >= takt ? C.navy : C.blue2} />)}
          <LabelList dataKey="cycle" position="right" style={{ fontSize: 11, fontWeight: 600 }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
