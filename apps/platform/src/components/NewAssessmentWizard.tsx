'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { Stepper } from './Stepper';
import { FormField } from './FormField';
import { AlphaNotice } from './AlphaNotice';
import { PBRSScorePanel } from './PBRSScorePanel';
import { SAMPLE_PBRS_SCORE } from '@phoenix/pbrs';

const STEPS = ['Asset Details', 'Business Context', 'Evidence & Sources', 'PBRS Review', 'Output Decision'];

const DEPARTMENTS = [
  'Corporate Communications',
  'Marketing',
  'Human Resources',
  'Legal',
  'Risk & Compliance',
  'Executive Offices',
];

const RISK_SENSITIVITY = ['Low', 'Medium', 'High'];

export function NewAssessmentWizard() {
  const [step, setStep] = useState(1);

  const goNext = () => setStep((s) => Math.min(s + 1, STEPS.length));
  const goBack = () => setStep((s) => Math.max(s - 1, 1));

  return (
    <>
      <div className="mb-8">
        <AlphaNotice>
          This is an Alpha UI workflow. Assessment processing is not connected to a backend yet — nothing you enter
          here is saved or scored.
        </AlphaNotice>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-6 mb-8">
        <Stepper steps={STEPS} activeStep={step} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white border border-gray-200 rounded-xl p-7">
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-phx-navy">Asset Details</h2>
              <FormField label="Asset name" name="assetName" placeholder="e.g. Executive AI Brief" />
              <FormField label="Asset type" name="assetType" placeholder="e.g. Executive Briefing" />
              <FormField label="Department" name="department" type="select" options={DEPARTMENTS} />
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-phx-navy">Business Context</h2>
              <FormField label="Intended audience" name="audience" placeholder="e.g. Board of Directors" />
              <FormField
                label="Business use"
                name="businessUse"
                type="textarea"
                placeholder="Describe how this asset will be used in the business."
              />
              <FormField label="Risk sensitivity" name="riskSensitivity" type="select" options={RISK_SENSITIVITY} />
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-phx-navy">Evidence & Sources</h2>
              <FormField
                label="Evidence notes"
                name="evidenceNotes"
                type="textarea"
                rows={5}
                placeholder="Attach or describe the source material, data, or references supporting this asset."
                helpText="File attachments are not available in this Alpha preview."
              />
              <FormField label="Reviewer" name="reviewer" placeholder="e.g. Hossam M." />
            </div>
          )}

          {step === 4 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-phx-navy">PBRS Review</h2>
              <p className="text-sm text-gray-500">
                Review the illustrative PBRS score preview to the right before finalizing this assessment. Live
                scoring is not connected in this Alpha build — the preview shown is sample data.
              </p>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-5">
              <h2 className="text-base font-bold text-phx-navy">Output Decision</h2>
              <FormField
                label="Decision notes"
                name="decisionNotes"
                type="textarea"
                placeholder="Record the readiness decision and any follow-up actions."
              />
              <div className="rounded-lg border border-dashed border-gray-300 p-5 text-center">
                <p className="text-sm text-gray-500">
                  Submitting a decision is not available in this Alpha preview.
                </p>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between mt-8 pt-6 border-t border-gray-100">
            <button
              onClick={goBack}
              disabled={step === 1}
              className="px-5 py-2.5 rounded-lg text-sm font-semibold text-phx-navy border border-gray-300 disabled:opacity-40 disabled:cursor-not-allowed hover:border-phx-cyan hover:text-phx-cyan-dark transition-colors"
            >
              Back
            </button>
            {step < STEPS.length ? (
              <button
                onClick={goNext}
                className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-phx-cyan text-white hover:bg-phx-cyan-dark transition-colors shadow-sm"
              >
                Continue
              </button>
            ) : (
              <Link
                href="/assessments"
                className="px-6 py-2.5 rounded-lg text-sm font-semibold bg-phx-navy text-white hover:bg-phx-navy-light transition-colors shadow-sm"
              >
                Return to Assessments
              </Link>
            )}
          </div>
        </div>

        <div>
          <PBRSScorePanel score={SAMPLE_PBRS_SCORE} title="PBRS Readiness Preview" />
          <p className="mt-4 text-xs text-gray-400">Illustrative sample score — not calculated from your inputs.</p>
        </div>
      </div>
    </>
  );
}
