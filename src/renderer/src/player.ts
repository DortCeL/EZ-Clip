import { create } from 'zustand'
import { mediaUrl } from '../../shared/api'
import { segmentSpeed } from '../../shared/speed'
import { layoutSequence, locate, type SequenceLayout } from './lib/sequence'
import { getMedia, useStore, type MediaItem } from './store'

interface PlaybackState {
  time: number
  duration: number
  playing: boolean
  /** Shuttle speed; negative means reverse. */
  speed: number
}

export const usePlayback = create<PlaybackState>(() => ({
  time: 0,
  duration: 0,
  playing: false,
  speed: 1
}))

const MAX_SPEED = 8
/** How close to a segment's end playback must get before jumping to the next one. */
const BOUNDARY_EPSILON = 0.012

/**
 * Drives the single <video> element in two modes:
 * - source: plays one imported file directly
 * - timeline: plays the segment list back-to-back, swapping sources at boundaries
 */
class PlayerEngine {
  private video: HTMLVideoElement | null = null
  private loadedPath: string | null = null
  private loading: Promise<void> | null = null
  private raf = 0
  private reverseActive = false
  private sourcePositions = new Map<string, number>()
  private currentSourceId: string | null = null

  private layout: SequenceLayout = { placed: [], total: 0 }
  private segIndex = -1
  private timelineTime = 0
  private transitioning = false
  private scrubTarget: number | null = null
  private scrubbing = false

  attach(video: HTMLVideoElement): () => void {
    this.video = video
    const publish = (): void => this.publish()
    const onPlay = (): void => {
      usePlayback.setState({ playing: true })
      this.startLoop()
    }
    const onPause = (): void => {
      if (!this.reverseActive && !this.transitioning) usePlayback.setState({ playing: false })
      this.publish()
    }
    const onEnded = (): void => {
      if (this.mode === 'timeline') void this.advance(true)
      else onPause()
    }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onEnded)
    video.addEventListener('seeked', publish)
    video.addEventListener('timeupdate', publish)
    video.addEventListener('loadedmetadata', publish)

    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.mode !== prev.mode) {
        this.onModeChange(prev.mode)
      } else if (s.mode === 'source' && s.activeSourceId !== prev.activeSourceId) {
        this.openSource()
      } else if (s.segments !== prev.segments) {
        this.relayout(s.mode === 'timeline')
      }
    })
    this.relayout(false)
    if (this.mode === 'source') this.openSource()
    else void this.seek(this.timelineTime)

    return () => {
      unsubscribe()
      cancelAnimationFrame(this.raf)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onEnded)
      video.removeEventListener('seeked', publish)
      video.removeEventListener('timeupdate', publish)
      video.removeEventListener('loadedmetadata', publish)
      this.video = null
      this.loadedPath = null
    }
  }

  // ---- state -------------------------------------------------------------

  private get mode(): 'source' | 'timeline' {
    return useStore.getState().mode
  }

  private activeItem(): MediaItem | undefined {
    if (this.mode === 'timeline') return this.layout.placed[this.segIndex]?.item
    return getMedia(useStore.getState().activeSourceId)
  }

  get time(): number {
    const v = this.video?.currentTime ?? 0
    if (this.mode === 'source') return v
    const p = this.layout.placed[this.segIndex]
    if (!p) return this.timelineTime
    if (this.transitioning) return this.timelineTime
    const sourceSpan = p.playEnd - p.playStart
    const sourceDelta = Math.min(Math.max(v - p.playStart, 0), sourceSpan)
    return p.offset + sourceDelta / segmentSpeed(p.seg.speed)
  }

  get duration(): number {
    if (this.mode === 'timeline') return this.layout.total
    return this.activeItem()?.info.duration ?? 0
  }

  get fps(): number {
    return this.activeItem()?.info.video?.fps || 60
  }

  /** Timeline segment under the playhead (timeline mode only). */
  get currentSegmentId(): string | null {
    return this.mode === 'timeline' ? (this.layout.placed[this.segIndex]?.seg.id ?? null) : null
  }

  /** Source-file time under the playhead. */
  get sourceTime(): number {
    return this.video?.currentTime ?? 0
  }

  get sequence(): SequenceLayout {
    return this.layout
  }

  /** Where the playhead should land after the next timeline edit. */
  setTimelineTimeHint(t: number): void {
    this.timelineTime = Math.max(0, t)
  }

  rememberSourcePosition(sourceId: string, t: number): void {
    this.sourcePositions.set(sourceId, t)
  }

  private publish(): void {
    const time = this.time
    if (this.mode === 'timeline' && !this.transitioning) this.timelineTime = time
    usePlayback.setState({ time: this.scrubTarget ?? time, duration: this.duration })
  }

  private startLoop(): void {
    cancelAnimationFrame(this.raf)
    const tick = (): void => {
      if (this.mode === 'timeline') this.checkBoundary()
      this.publish()
      if (this.video && !this.video.paused) this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  // ---- mode / source handling --------------------------------------------

  private onModeChange(prevMode: 'source' | 'timeline'): void {
    this.stopShuttle()
    this.video?.pause()
    if (prevMode === 'source' && this.currentSourceId) {
      this.sourcePositions.set(this.currentSourceId, this.video?.currentTime ?? 0)
    }
    if (this.mode === 'timeline') {
      this.relayout(false)
      if (this.layout.placed.length === 0) {
        this.segIndex = -1
        this.unload()
        return
      }
      void this.seek(Math.min(this.timelineTime, this.layout.total))
    } else {
      this.currentSourceId = null
      this.openSource()
    }
  }

  private openSource(): void {
    this.stopShuttle()
    this.video?.pause()
    if (this.currentSourceId) this.sourcePositions.set(this.currentSourceId, this.video?.currentTime ?? 0)
    const item = this.activeItem()
    this.currentSourceId = item?.id ?? null
    if (!item) {
      this.unload()
      return
    }
    void this.load(item.info.path, this.sourcePositions.get(item.id) ?? 0).then(() => this.publish())
  }

  private relayout(reseek = true): void {
    const s = useStore.getState()
    this.layout = layoutSequence(s.segments, s.media)
    if (!reseek) return
    this.pause()
    if (this.layout.placed.length === 0) {
      this.segIndex = -1
      this.timelineTime = 0
      this.unload()
      return
    }
    void this.seek(Math.min(this.timelineTime, this.layout.total))
  }

  private unload(): void {
    if (!this.video) return
    this.video.removeAttribute('src')
    this.video.load()
    this.loadedPath = null
    usePlayback.setState({ time: 0, duration: this.duration, playing: false })
  }

  private load(filePath: string, time: number): Promise<void> {
    const video = this.video
    if (!video) return Promise.resolve()
    if (this.loadedPath === filePath) {
      return (this.loading ?? Promise.resolve()).then(() => this.seekVideo(time))
    }
    this.loadedPath = filePath
    video.src = mediaUrl(filePath)
    this.loading = new Promise<void>((resolve) => {
      const done = (): void => {
        video.removeEventListener('loadedmetadata', done)
        video.removeEventListener('error', done)
        this.loading = null
        resolve()
      }
      video.addEventListener('loadedmetadata', done)
      video.addEventListener('error', done)
    })
    return this.loading.then(() => this.seekVideo(time))
  }

  private seekVideo(time: number): Promise<void> {
    const video = this.video
    if (!video) return Promise.resolve()
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - time) < 1e-4) {
        resolve()
        return
      }
      const done = (): void => {
        video.removeEventListener('seeked', done)
        resolve()
      }
      video.addEventListener('seeked', done)
      video.currentTime = time
    })
  }

  // ---- timeline playback -------------------------------------------------

  private checkBoundary(): void {
    const p = this.layout.placed[this.segIndex]
    const video = this.video
    if (!p || !video || this.transitioning) return
    if (video.currentTime >= p.playEnd - BOUNDARY_EPSILON) void this.advance(!video.paused)
  }

  private async advance(keepPlaying: boolean): Promise<void> {
    if (this.transitioning) return
    const next = this.layout.placed[this.segIndex + 1]
    if (!next) {
      this.video?.pause()
      this.timelineTime = this.layout.total
      usePlayback.setState({ time: this.layout.total, playing: false })
      return
    }
    const current = this.layout.placed[this.segIndex]
    const contiguous =
      current &&
      current.item.info.path === next.item.info.path &&
      Math.abs(current.playEnd - next.playStart) < BOUNDARY_EPSILON
    const sameRate = !!current && segmentSpeed(current.seg.speed) === segmentSpeed(next.seg.speed)
    this.segIndex++
    this.followSelection()
    if (contiguous && sameRate) return
    if (contiguous) {
      this.applyRate()
      return
    }

    this.transitioning = true
    this.timelineTime = next.offset
    try {
      await this.load(next.item.info.path, next.playStart)
      this.applyRate()
      if (keepPlaying && this.video) await this.video.play().catch(() => undefined)
    } finally {
      this.transitioning = false
      this.publish()
    }
  }

  private followSelection(): void {
    const id = this.currentSegmentId
    if (id && useStore.getState().selectedSegmentId !== id) useStore.getState().selectSegment(id)
  }

  // ---- transport ---------------------------------------------------------

  async seek(t: number): Promise<void> {
    const clamped = Math.min(Math.max(0, t), this.duration)
    if (this.mode === 'source') {
      await this.seekVideo(clamped)
      this.publish()
      return
    }
    const index = locate(this.layout, clamped)
    const p = this.layout.placed[index]
    if (!p) return
    const wasPlaying = !!this.video && !this.video.paused
    this.segIndex = index
    this.timelineTime = clamped
    const sourceTime = Math.min(p.playStart + (clamped - p.offset) * segmentSpeed(p.seg.speed), p.playEnd)
    if (this.loadedPath !== p.item.info.path) this.transitioning = true
    try {
      await this.load(p.item.info.path, sourceTime)
      this.applyRate()
      if (wasPlaying && this.video?.paused) await this.video.play().catch(() => undefined)
    } finally {
      this.transitioning = false
      this.publish()
    }
  }

  /**
   * Seek for drag-scrubbing. The playhead follows the pointer immediately; the video only
   * decodes the latest requested position, so fast drags never queue up a backlog of seeks.
   */
  scrub(t: number): void {
    this.scrubTarget = Math.min(Math.max(0, t), this.duration)
    usePlayback.setState({ time: this.scrubTarget })
    if (this.scrubbing) return
    this.scrubbing = true
    void (async () => {
      try {
        while (this.scrubTarget != null) {
          const target = this.scrubTarget
          await this.seek(target)
          if (this.scrubTarget === target) this.scrubTarget = null
        }
      } finally {
        this.scrubbing = false
        this.scrubTarget = null
        this.publish()
      }
    })()
  }

  play(speed = 1): void {
    const video = this.video
    if (!video || !this.loadedPath) return
    this.stopShuttle()
    if (this.time >= this.duration - 0.05) {
      void this.seek(0).then(() => this.play(speed))
      return
    }
    usePlayback.setState({ speed })
    this.applyRate()
    void video.play()
  }

  /**
   * Shuttle speed times the clip's own speed. A slowed clip also drops the pitch,
   * and a sped-up clip raises it; plain J/K/L review does not.
   */
  private applyRate(): void {
    const video = this.video
    if (!video) return
    const clipSpeed = this.mode === 'timeline' ? segmentSpeed(this.layout.placed[this.segIndex]?.seg.speed) : 1
    const shuttle = usePlayback.getState().speed
    const forward = shuttle > 0 ? shuttle : 1
    const keepPitch = !(this.mode === 'timeline' && clipSpeed !== 1)
    video.playbackRate = Math.min(16, Math.max(0.0625, forward * clipSpeed))
    video.preservesPitch = keepPitch
    ;(video as HTMLVideoElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = keepPitch
  }

  pause(): void {
    this.stopShuttle()
    this.video?.pause()
  }

  togglePlay(): void {
    if (usePlayback.getState().playing) this.pause()
    else this.play()
  }

  /** L: play forward, doubling speed on repeated presses. */
  shuttleForward(): void {
    const { playing, speed } = usePlayback.getState()
    this.play(playing && speed > 0 ? Math.min(speed * 2, MAX_SPEED) : 1)
  }

  /** J: play backwards (by repeated seeking), doubling speed on repeated presses. */
  shuttleReverse(): void {
    const video = this.video
    if (!video || !this.loadedPath) return
    const { speed } = usePlayback.getState()
    const next = this.reverseActive ? Math.max(speed * 2, -MAX_SPEED) : -1
    usePlayback.setState({ speed: next, playing: true })
    if (this.reverseActive) return
    this.reverseActive = true
    video.pause()
    void this.reverseLoop()
  }

  private async reverseLoop(): Promise<void> {
    let last = performance.now()
    while (this.reverseActive) {
      await new Promise((r) => requestAnimationFrame(r))
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      const target = this.time + dt * usePlayback.getState().speed
      if (target <= 0) {
        await this.seek(0)
        this.stopShuttle()
        break
      }
      await this.seek(target)
    }
  }

  private stopShuttle(): void {
    if (!this.reverseActive) return
    this.reverseActive = false
    usePlayback.setState({ playing: false, speed: 1 })
  }

  /** Closes the open file so a source can be deleted after export. */
  release(): void {
    this.stopShuttle()
    this.scrubbing = false
    this.scrubTarget = null
    this.transitioning = false
    this.segIndex = -1
    this.pause()
    this.unload()
  }

  /** K: stop. */
  stop(): void {
    this.pause()
    usePlayback.setState({ speed: 1 })
  }

  nudge(seconds: number): void {
    void this.seek(this.time + seconds)
  }

  stepFrames(frames: number): void {
    this.pause()
    const clipSpeed = this.mode === 'timeline' ? segmentSpeed(this.layout.placed[this.segIndex]?.seg.speed) : 1
    void this.seek(this.time + frames / this.fps / clipSpeed)
  }
}

export const engine = new PlayerEngine()
