import { addMarkedRange, clearMarks, markIn, markOut } from '../lib/actions'
import { formatTime } from '../lib/format'
import { snapToKeyframe } from '../lib/keyframes'
import { engine, usePlayback } from '../player'
import { useStore } from '../store'

export function Transport() {
  const time = usePlayback((s) => s.time)
  const duration = usePlayback((s) => s.duration)
  const playing = usePlayback((s) => s.playing)
  const speed = usePlayback((s) => s.speed)
  const mode = useStore((s) => s.mode)
  const item = useStore((s) => s.media.find((m) => m.id === s.activeSourceId))
  const marks = useStore((s) => (item ? s.marks[item.id] : undefined))
  const hasSegments = useStore((s) => s.segments.length > 0)
  const disabled = mode === 'source' ? !item : !hasSegments

  const inSnapped = marks?.in != null ? snapToKeyframe(item?.keyframes ?? null, marks.in) : null

  return (
    <div className="flex h-12 shrink-0 items-center gap-3 px-4">
      <button
        className="bg-accent hover:bg-accent-strong flex h-8 w-8 items-center justify-center rounded-full text-white disabled:opacity-40"
        onClick={() => engine.togglePlay()}
        disabled={disabled}
        title="Play / pause (Space)"
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div className="font-mono text-sm tabular-nums">
        <span className="text-zinc-100">{formatTime(time)}</span>
        <span className="text-zinc-500"> / {formatTime(duration)}</span>
      </div>
      {playing && speed !== 1 && (
        <span className="rounded bg-zinc-800 px-1.5 py-0.5 font-mono text-[11px] text-amber-300">
          {speed > 0 ? '▶▶' : '◀◀'} {Math.abs(speed)}×
        </span>
      )}

      {mode === 'source' && (
      <div className="ml-auto flex items-center gap-2">
        <MarkButton label="In" shortcut="I" value={inSnapped} onClick={markIn} disabled={disabled} />
        <MarkButton label="Out" shortcut="O" value={marks?.out ?? null} onClick={markOut} disabled={disabled} />
        {(marks?.in != null || marks?.out != null) && (
          <button className="text-xs text-zinc-500 hover:text-zinc-200" onClick={clearMarks} title="Clear marks (X)">
            clear
          </button>
        )}
        <button
          className="bg-accent hover:bg-accent-strong rounded-md px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40"
          onClick={addMarkedRange}
          disabled={disabled}
          title="Add marked range to the timeline (A or Enter)"
        >
          Add to timeline <kbd className="ml-1">A</kbd>
        </button>
      </div>
      )}
    </div>
  )
}

function MarkButton(props: {
  label: string
  shortcut: string
  value: number | null
  onClick: () => void
  disabled: boolean
}) {
  return (
    <button
      className="flex items-center gap-2 rounded-md border border-zinc-700 px-2 py-1 text-xs hover:border-zinc-500 disabled:opacity-40"
      onClick={props.onClick}
      disabled={props.disabled}
      title={`Mark ${props.label.toLowerCase()} (${props.shortcut})`}
    >
      <kbd>{props.shortcut}</kbd>
      <span className="text-zinc-400">{props.label}</span>
      <span className="font-mono text-zinc-200 tabular-nums">
        {props.value != null ? formatTime(props.value) : '--:--.--'}
      </span>
    </button>
  )
}
