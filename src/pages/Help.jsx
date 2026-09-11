export default function Help({ onReplay }) {
  return (
    <div className="p-6 max-w-lg">
      <h1 className="font-display font-extrabold text-2xl text-spruce-deep mb-1">How this works</h1>
      <p className="text-ink-soft mb-6">
        Envelope budgeting means giving every dollar a job before you spend it. Assign money from
        Ready to Assign into envelopes, then spend from the right envelope as you go, so your
        balances always match reality.
      </p>
      <button
        onClick={onReplay}
        className="rounded-lg bg-spruce text-white px-4 py-2 text-sm font-semibold"
      >
        Start the walkthrough
      </button>
    </div>
  )
}
