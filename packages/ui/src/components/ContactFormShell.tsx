'use client';

import React from 'react';

export function ContactFormShell() {
  return (
    <form
      className="bg-white border border-gray-200 rounded-2xl p-8 lg:p-10 space-y-6"
      onSubmit={(e) => e.preventDefault()}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        <div>
          <label htmlFor="firstName" className="block text-sm font-medium text-phx-navy mb-2">
            First name
          </label>
          <input
            id="firstName"
            name="firstName"
            type="text"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent"
            placeholder="Jane"
          />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-sm font-medium text-phx-navy mb-2">
            Last name
          </label>
          <input
            id="lastName"
            name="lastName"
            type="text"
            className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent"
            placeholder="Doe"
          />
        </div>
      </div>

      <div>
        <label htmlFor="workEmail" className="block text-sm font-medium text-phx-navy mb-2">
          Work email
        </label>
        <input
          id="workEmail"
          name="workEmail"
          type="email"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent"
          placeholder="jane@company.com"
        />
      </div>

      <div>
        <label htmlFor="company" className="block text-sm font-medium text-phx-navy mb-2">
          Company
        </label>
        <input
          id="company"
          name="company"
          type="text"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent"
          placeholder="Company name"
        />
      </div>

      <div>
        <label htmlFor="role" className="block text-sm font-medium text-phx-navy mb-2">
          Role
        </label>
        <select
          id="role"
          name="role"
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent bg-white"
        >
          <option>Chief AI Officer</option>
          <option>Enterprise Architect</option>
          <option>AI Governance Lead</option>
          <option>Internal Audit</option>
          <option>Digital Transformation Leader</option>
          <option>Other</option>
        </select>
      </div>

      <div>
        <label htmlFor="message" className="block text-sm font-medium text-phx-navy mb-2">
          What would you like to assess?
        </label>
        <textarea
          id="message"
          name="message"
          rows={4}
          className="w-full px-4 py-3 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-phx-cyan focus:border-transparent resize-none"
          placeholder="Tell us about your AI outputs and readiness goals..."
        />
      </div>

      <button
        type="submit"
        className="w-full inline-flex items-center justify-center px-7 py-3.5 bg-phx-cyan text-white text-sm font-semibold rounded-lg hover:bg-phx-cyan-dark transition-colors duration-200"
      >
        Request Assessment
      </button>
      <p className="text-xs text-gray-400 text-center">
        This form is a UI preview. Submissions are not yet connected to a backend.
      </p>
    </form>
  );
}
