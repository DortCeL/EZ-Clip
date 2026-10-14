import type { MediaInfo } from './types'

function nominalFps(rate: string): number {
  const [n, d] = rate.split('/').map(Number)
  return n && d ? Math.round((n / d) * 100) / 100 : 0
}

/**
 * Lossless joining (stream copy + concat) needs every source to share the same codec
 * parameters. Returns human-readable problems; an empty list means compatible.
 */
export function checkCompatibility(infos: MediaInfo[]): string[] {
  const issues = new Set<string>()
  const [ref, ...others] = infos
  if (!ref) return []
  const rv = ref.video

  for (const other of others) {
    const ov = other.video
    const vs = `${other.name} vs ${ref.name}`
    if (!rv || !ov) {
      issues.add(`${!rv ? ref.name : other.name} has no video stream`)
      continue
    }
    if (rv.codec !== ov.codec) issues.add(`Video codec differs (${ov.codec} vs ${rv.codec}): ${vs}`)
    if (rv.profile !== ov.profile) {
      issues.add(`Codec profile differs (${ov.profile ?? '?'} vs ${rv.profile ?? '?'}): ${vs}`)
    }
    if (rv.width !== ov.width || rv.height !== ov.height) {
      issues.add(`Resolution differs (${ov.width}×${ov.height} vs ${rv.width}×${rv.height}): ${vs}`)
    }
    if (nominalFps(rv.fpsNominal) !== nominalFps(ov.fpsNominal)) {
      issues.add(`Frame rate differs (${ov.fpsNominal} vs ${rv.fpsNominal}): ${vs}`)
    }
    if (rv.pixFmt !== ov.pixFmt) issues.add(`Pixel format differs (${ov.pixFmt} vs ${rv.pixFmt}): ${vs}`)

    if (ref.audio.length !== other.audio.length) {
      issues.add(`Audio track count differs (${other.audio.length} vs ${ref.audio.length}): ${vs}`)
      continue
    }
    ref.audio.forEach((ra, i) => {
      const oa = other.audio[i]
      if (ra.codec !== oa.codec || ra.sampleRate !== oa.sampleRate || ra.channels !== oa.channels) {
        issues.add(
          `Audio track ${i + 1} differs (${oa.codec} ${oa.sampleRate}Hz ${oa.channels}ch vs ` +
            `${ra.codec} ${ra.sampleRate}Hz ${ra.channels}ch): ${vs}`
        )
      }
    })
  }
  return [...issues]
}
