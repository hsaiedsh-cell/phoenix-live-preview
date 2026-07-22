import React from 'react';

interface StatCardProps {
  label: string;
  value: string;
  icon?: React.ReactNode;
  trend?: { direction: 'up' | 'down' | 'flat'; label: string };
}

const trendColor = {
  up: 'text-emerald-600',
  down: 'text-red-600',
  flat: 'text-gray-400',
};

export function StatCard({ label, value, icon, trend }: StatCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
        {icon && <span className="text-phx-cyan">{icon}</span>}
      </div>
      <p className="text-3xl font-extrabold text-phx-navy tracking-tight">{value}</p>
      {trend && (
        <p className={`mt-2 text-xs font-medium ${trendColor[trend.direction]}`}>{trend.label}</p>
      )}
    </div>
  );
}
