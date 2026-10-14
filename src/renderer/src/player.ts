import { create } from 'zustand'
import { mediaUrl } from '../../shared/api'
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

class PlayerEngine {
  private video: HTMLVideoElement | null = null
  private loadedPath: string | null = null
  private loading: Promise<void> | null = null
  private raf = 0
  private reverseActive = false
  private sourcePositions = new Map<string, number>()
  private currentSourceId: string | null = null

  attach(video: HTMLVideoElement): () => void {
    this.video = video
    const publish = (): void => this.publish()
    const onPlay = (): void => {
      usePlayback.setState({ playing: true })
      this.startLoop()
    }
    const onPause = (): void => {
      if (!this.reverseActive) usePlayback.setState({ playing: false })
      this.publish()
    }
    video.addEventListener('play', onPlay)
    video.addEventListener('pause', onPause)
    video.addEventListener('ended', onPause)
    video.addEventListener('seeked', publish)
    video.addEventListener('timeupdate', publish)
    video.addEventListener('loadedmetadata', publish)

    const unsubscribe = useStore.subscribe((s, prev) => {
      if (s.activeSourceId !== prev.activeSourceId || s.mode !== prev.mode) this.syncToStore()
    })
    this.syncToStore()

    return () => {
      unsubscribe()
      cancelAnimationFrame(this.raf)
      video.removeEventListener('play', onPlay)
      video.removeEventListener('pause', onPause)
      video.removeEventListener('ended', onPause)
      video.removeEventListener('seeked', publish)
      video.removeEventListener('timeupdate', publish)
      video.removeEventListener('loadedmetadata', publish)
      this.video = null
      this.loadedPath = null
    }
  }

  // ---- state -------------------------------------------------------------

  private activeItem(): MediaItem | undefined {
    return getMedia(useStore.getState().activeSourceId)
  }

  get time(): number {
    return this.video?.currentTime ?? 0
  }

  get duration(): number {
    return this.activeItem()?.info.duration ?? 0
  }

  get fps(): number {
    return this.activeItem()?.info.video?.fps || 60
  }

  private publish(): void {
    usePlayback.setState({ time: this.time, duration: this.duration })
  }

  private startLoop(): void {
    cancelAnimationFrame(this.raf)
    const tick = (): void => {
      this.publish()
      if (this.video && !this.video.paused) this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private syncToStore(): void {
    this.stopShuttle()
    this.video?.pause()
    if (this.currentSourceId) this.sourcePositions.set(this.currentSourceId, this.time)
    const item = this.activeItem()
    this.currentSourceId = item?.id ?? null
    if (!item) {
      this.unload()
      return
    }
    void this.load(item.info.path, this.sourcePositions.get(item.id) ?? 0)
  }

  private unload(): void {
    if (!this.video) return
    this.video.removeAttribute('src')
    this.video.load()
    this.loadedPath = null
    usePlayback.setState({ time: 0, duration: 0, playing: false })
  }

  private load(filePath: string, time: number): Promise<void> {
    const video = this.video
    if (!video) return Promise.resolve()
    if (this.loadedPath === filePath) {
      return this.loading ?? this.seekVideo(time)
    }
    this.loadedPath = filePath
    video.src = mediaUrl(filePath)
    this.loading = new Promise<void>((resolve) => {
      const done = (): void => {
        video.removeEventListener('loadedmetadata', done)
        video.removeEventListener('error', done)
        this.loading = null
        void this.seekVideo(time).then(resolve)
      }
      video.addEventListener('loadedmetadata', done)
      video.addEventListener('error', done)
    })
    return this.loading
  }

  private seekVideo(time: number): Promise<void> {
    const video = this.video
    if (!video) return Promise.resolve()
    return new Promise((resolve) => {
      if (Math.abs(video.currentTime - time) < 1e-4) {
        this.publish()
        resolve()
        return
      }
      const done = (): void => {
        video.removeEventListener('seeked', done)
        resolve()
      }
      video.addEventListener('seeked', done)
      video.currentTime = time
      this.publish()
    })
  }

  // ---- transport ---------------------------------------------------------

  seek(t: number): Promise<void> {
    const clamped = Math.min(Math.max(0, t), this.duration)
    return this.seekVideo(clamped)
  }

  play(speed = 1): void {
    const video = this.video
    if (!video || !this.loadedPath) return
    this.stopShuttle()
    if (this.time >= this.duration - 0.05) void this.seek(0)
    video.playbackRate = speed
    usePlayback.setState({ speed })
    void video.play()
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
    void this.seek(this.time + frames / this.fps)
  }
}

export const engine = new PlayerEngine()
