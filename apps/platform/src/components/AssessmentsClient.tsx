'use client';

import React, { useMemo, useState } from 'react';
import { AssessmentCard } from './AssessmentCard';
import { EmptyState } from './EmptyState';
import { IconFilter, IconClipboard } from './Icons';
import type { AssessmentListItemViewModel, SimpleGrade } from '@/lib/api-client';
import type { RiskLevel } from '@phoenix/core';

const STATUSES = ['Draft', 'In Review', 'Business Ready', 'Certified', 'Needs Improvement'];
const RISK_LEVELS: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical'];
const GRADES: SimpleGrade[] = ['A', 'B', 'C', 'Hold'];

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-phx-navy bg-white focus:outline-none focus:ring-2 focus:ring-phx-cyan/40 focus:border-phx-cyan"
      >
        <option value="">All</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

interface AssessmentsClientProps {
  items: AssessmentListItemViewModel[];
}

export function AssessmentsClient({ items }: AssessmentsClientProps) {
  const [status, setStatus] = useState('');
  const [department, setDepartment] = useState('');
  const [risk, setRisk] = useState('');
  const [grade, setGrade] = useState('');

  const departments = useMemo(
    () => Array.from(new Set(items.map((item) => item.asset.department))),
    [items]
  );

  const filtered = useMemo(() => {
    return items.filter((item) => {
      if (status && item.statusLabel !== status) return false;
      if (department && item.asset.department !== department) return false;
      if (risk && item.score.summary.riskLevel !== risk) return false;
      if (grade && item.simpleGrade !== grade) return false;
      return true;
    });
  }, [items, status, department, risk, grade]);

  return (
    <>
      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-6">
        <div className="flex items-center gap-2 mb-4 text-gray-500">
          <IconFilter />
          <span className="text-xs font-semibold uppercase tracking-wide">Filters</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <FilterSelect label="Status" value={status} options={STATUSES} onChange={setStatus} />
          <FilterSelect label="Department" value={department} options={departments} onChange={setDepartment} />
          <FilterSelect label="Risk Level" value={risk} options={RISK_LEVELS} onChange={setRisk} />
          <FilterSelect label="Grade" value={grade} options={GRADES} onChange={setGrade} />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={<IconClipboard />}
          title="No assessments match these filters"
          description="Try adjusting or clearing your filters to see more assessed assets."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((item) => (
            <AssessmentCard key={item.asset.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
