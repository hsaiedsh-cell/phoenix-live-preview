import React from 'react';

interface SectionHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: 'left' | 'center';
  variant?: 'dark' | 'light';
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  align = 'left',
  variant = 'light',
}: SectionHeaderProps) {
  const isDark = variant === 'dark';
  const centered = align === 'center';

  return (
    <div className={`${centered ? 'text-center' : ''} mb-16`}>
      {eyebrow && (
        <p className="text-phx-cyan text-xs font-semibold tracking-[0.15em] uppercase mb-3">
          {eyebrow}
        </p>
      )}
      <h2
        className={`text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight ${
          isDark ? 'text-white' : 'text-phx-navy'
        } ${centered ? 'max-w-3xl mx-auto' : 'max-w-3xl'}`}
      >
        {title}
      </h2>
      {description && (
        <p
          className={`mt-5 text-base lg:text-lg leading-relaxed ${
            isDark ? 'text-gray-400' : 'text-gray-600'
          } ${centered ? 'max-w-2xl mx-auto' : 'max-w-2xl'}`}
        >
          {description}
        </p>
      )}
    </div>
  );
}
