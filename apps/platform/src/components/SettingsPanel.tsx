import React from 'react';

interface SettingsPanelProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

export function SettingsPanel({ title, description, children }: SettingsPanelProps) {
  return (
    <section className="bg-white border border-gray-200 rounded-xl p-6 sm:p-7">
      <div className="mb-5">
        <h2 className="text-base font-bold text-phx-navy">{title}</h2>
        {description && <p className="mt-1 text-sm text-gray-500">{description}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}
