export default function WorkspaceSwitcher({ workspaces, currentId, onSwitch }) {
  if (workspaces.length <= 1) return null
  return (
    <select
      value={currentId}
      onChange={(e) => onSwitch(Number(e.target.value))}
      className="w-full rounded-lg bg-spruce text-white text-sm px-2 py-1.5 mb-4 border border-white/20 select-field"
    >
      {workspaces.map((w) => (
        <option key={w.id} value={w.id} className="text-ink">
          {w.name}
        </option>
      ))}
    </select>
  )
}
