import { useState } from 'react'

const STEPS = [
  {
    title: 'Welcome to your budget',
    body: 'This is envelope budgeting: give every dollar a job before you spend it. Money goes into envelopes, and you spend from them.',
  },
  {
    title: 'Ready to Assign',
    body: 'Money you have not assigned yet shows at the top of the Budget screen. Your goal each month is to assign it all down to zero.',
  },
  {
    title: 'Envelopes',
    body: 'Each envelope is a spending category, grouped how you like. Assign money to an envelope, then spend from it. Set a target and the app tells you how much to fund each month.',
  },
  {
    title: 'Adding transactions',
    body: 'Use the + button to record what you spend or receive. Each transaction comes out of (or into) the right envelope, so your balances always match reality.',
  },
  {
    title: 'You are set',
    body: 'That is the whole idea. You can reopen this walkthrough any time from Help.',
  },
]

export default function Onboarding({ open, onClose }) {
  const [step, setStep] = useState(0)
  if (!open) return null

  const isLast = step === STEPS.length - 1
  const current = STEPS[step]

  function handleClose() {
    setStep(0)
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-ink/40 flex items-center justify-center p-4"
      onClick={handleClose}
    >
      <div
        className="bg-white w-full max-w-sm rounded-2xl border border-mist p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i === step ? 'bg-spruce' : 'bg-mist'}`}
              />
            ))}
          </div>
          <button
            onClick={handleClose}
            className="text-ink-soft hover:text-ink text-sm font-medium px-2 py-1 -mr-2"
            aria-label="Skip walkthrough"
          >
            Skip
          </button>
        </div>

        <h2 className="font-display font-bold text-xl text-spruce-deep mb-2">{current.title}</h2>
        <p className="text-ink text-sm leading-relaxed mb-6">{current.body}</p>

        <div className="flex items-center justify-between gap-3">
          <button
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="rounded-lg px-3 py-2 font-medium text-sm text-ink-soft disabled:opacity-0"
          >
            Back
          </button>
          {isLast ? (
            <button
              onClick={handleClose}
              className="rounded-lg bg-spruce text-white px-4 py-2 text-sm font-semibold"
            >
              Done
            </button>
          ) : (
            <button
              onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              className="rounded-lg bg-spruce text-white px-4 py-2 text-sm font-semibold"
            >
              Next
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
