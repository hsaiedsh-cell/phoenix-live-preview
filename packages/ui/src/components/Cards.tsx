import React from 'react';
import Link from 'next/link';

// --- CTA Button ---

interface CTAButtonProps {
  label: string;
  href: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

// Internal routes use Next.js <Link> for client-side navigation and prefetching.
// External protocols (mailto:, tel:, http(s):) must stay as plain anchors.
function isExternalHref(href: string): boolean {
  return /^(mailto:|tel:|https?:\/\/)/i.test(href);
}

export function CTAButton({ label, href, variant = 'primary', size = 'md' }: CTAButtonProps) {
  const base = 'inline-flex items-center justify-center font-semibold rounded-lg transition-all duration-200';
  const sizes = {
    sm: 'px-5 py-2.5 text-xs',
    md: 'px-7 py-3.5 text-sm',
    lg: 'px-9 py-4 text-base',
  };
  const variants = {
    primary: 'bg-phx-cyan text-white hover:bg-phx-cyan-dark shadow-sm hover:shadow-md',
    secondary: 'border border-gray-300 text-phx-navy hover:border-phx-cyan hover:text-phx-cyan',
    ghost: 'text-phx-cyan hover:text-phx-cyan-dark underline-offset-4 hover:underline',
  };
  const className = `${base} ${sizes[size]} ${variants[variant]}`;
  const content = (
    <>
      {label}
      {variant === 'ghost' && <span className="ml-1.5">→</span>}
    </>
  );

  if (isExternalHref(href)) {
    return (
      <a href={href} className={className}>
        {content}
      </a>
    );
  }

  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}

// --- Product Card ---

interface ProductCardProps {
  name: string;
  tagline: string;
  problem?: string;
  description: string;
  audience: string;
  value: string;
  icon: React.ReactNode;
  /** Compact mode reduces text density for dense grid contexts (e.g. homepage). */
  compact?: boolean;
}

export function ProductCard({ name, tagline, problem, description, audience, value, icon, compact = false }: ProductCardProps) {
  if (compact) {
    return (
      <div className="group relative bg-white border border-gray-200 rounded-xl p-7 hover:border-phx-cyan/40 hover:shadow-lg transition-all duration-300">
        <div className="w-11 h-11 rounded-lg bg-phx-navy flex items-center justify-center text-phx-cyan mb-5">
          {icon}
        </div>
        <h3 className="text-lg font-bold text-phx-navy mb-1">{name}</h3>
        <p className="text-sm text-phx-cyan font-medium mb-3">{tagline}</p>
        <p className="text-sm text-gray-600 leading-relaxed line-clamp-2">{value}</p>
      </div>
    );
  }

  return (
    <div className="group relative bg-white border border-gray-200 rounded-xl p-8 hover:border-phx-cyan/40 hover:shadow-lg transition-all duration-300">
      <div className="w-12 h-12 rounded-lg bg-phx-navy flex items-center justify-center text-phx-cyan mb-6">
        {icon}
      </div>
      <h3 className="text-xl font-bold text-phx-navy mb-1">{name}</h3>
      <p className="text-sm text-phx-cyan font-medium mb-5">{tagline}</p>
      <div className="space-y-4 pt-5 border-t border-gray-100">
        {problem && (
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Problem</p>
            <p className="text-sm text-gray-700 leading-relaxed">{problem}</p>
          </div>
        )}
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">What it does</p>
          <p className="text-sm text-gray-700 leading-relaxed">{description}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Who it serves</p>
          <p className="text-sm text-gray-700">{audience}</p>
        </div>
        <div>
          <p className="text-xs text-gray-400 uppercase tracking-wider font-medium mb-1">Business value</p>
          <p className="text-sm text-gray-700 leading-relaxed">{value}</p>
        </div>
      </div>
    </div>
  );
}

// --- Solution Card ---

interface SolutionCardProps {
  functionName: string;
  problem: string;
  solution: string;
  outcome: string;
  icon?: React.ReactNode;
}

export function SolutionCard({ functionName, problem, solution, outcome, icon }: SolutionCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden hover:shadow-md transition-shadow duration-300">
      <div className="p-8">
        <div className="flex items-center gap-3 mb-5">
          {icon && (
            <div className="w-9 h-9 rounded-lg bg-phx-cyan/10 flex items-center justify-center text-phx-cyan flex-shrink-0">
              {icon}
            </div>
          )}
          <h3 className="text-lg font-bold text-phx-navy">{functionName}</h3>
        </div>
        <div className="space-y-5">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wider font-semibold mb-2">The Challenge</p>
            <p className="text-sm text-gray-600 leading-relaxed">{problem}</p>
          </div>
          <div>
            <p className="text-xs text-phx-cyan uppercase tracking-wider font-semibold mb-2">Phoenix Solution</p>
            <p className="text-sm text-gray-600 leading-relaxed">{solution}</p>
          </div>
          <div>
            <p className="text-xs text-emerald-600 uppercase tracking-wider font-semibold mb-2">Business-Ready Outcome</p>
            <p className="text-sm text-gray-700 leading-relaxed font-medium">{outcome}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Resource Card ---

interface ResourceCardProps {
  title: string;
  description: string;
  category: string;
  status?: string;
}

export function ResourceCard({ title, description, category, status = 'Coming Soon' }: ResourceCardProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-7 hover:border-phx-cyan/30 hover:shadow-sm transition-all duration-200">
      <p className="text-xs text-phx-cyan font-semibold uppercase tracking-wider mb-3">{category}</p>
      <h3 className="text-lg font-bold text-phx-navy mb-3">{title}</h3>
      <p className="text-sm text-gray-600 leading-relaxed mb-5">{description}</p>
      <span className="inline-block text-xs font-medium text-gray-400 bg-gray-100 px-3 py-1 rounded-full">
        {status}
      </span>
    </div>
  );
}

// --- Metric Panel ---

interface MetricPanelProps {
  value: string;
  label: string;
  qualifier?: string;
  variant?: 'dark' | 'light';
}

export function MetricPanel({ value, label, qualifier, variant = 'dark' }: MetricPanelProps) {
  const isDark = variant === 'dark';
  return (
    <div
      className={`rounded-xl p-8 text-center ${
        isDark ? 'bg-phx-navy-light border border-phx-navy-mid' : 'bg-white border border-gray-200'
      }`}
    >
      <p className={`text-4xl lg:text-5xl font-extrabold mb-2 ${isDark ? 'text-phx-cyan' : 'text-phx-navy'}`}>
        {value}
      </p>
      <p className={`text-sm font-medium ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{label}</p>
      {qualifier && (
        <p className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>{qualifier}</p>
      )}
    </div>
  );
}

// --- Feature Grid Item ---

interface FeatureGridItemProps {
  icon: React.ReactNode;
  title: string;
  description: string;
}

export function FeatureGridItem({ icon, title, description }: FeatureGridItemProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-7">
      <div className="w-10 h-10 rounded-lg bg-phx-cyan/10 flex items-center justify-center text-phx-cyan mb-4">
        {icon}
      </div>
      <h3 className="text-base font-bold text-phx-navy mb-2">{title}</h3>
      <p className="text-sm text-gray-600 leading-relaxed">{description}</p>
    </div>
  );
}
