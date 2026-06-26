import { useEffect, useState } from 'react'
import BackgroundTimer from 'react-native-background-timer'
import { exitApp } from '@/core/common'
import playerState from '@/store/player/state'
import settingState from '@/store/setting/state'
import { setVolume } from '@/plugins/player'

type Hook = (time: number, isPlayedStop: boolean) => void
type SongCountHook = (remaining: number) => void

const timeoutTools = {
  bgTimeout: null as number | null,
  timeout: null as NodeJS.Timer | null,
  startTime: 0,
  time: -1,
  timeHooks: [] as Hook[],
  exit() {
    if (settingState.setting['player.timeoutExitPlayed'] && playerState.isPlay) {
      global.lx.isPlayedStop = true
      this.callHooks()
    } else {
      exitApp('Timeout Exit')
    }
  },
  getTime() {
    return Math.max(this.time - Math.round((performance.now() - this.startTime) / 1000), -1)
  },
  callHooks() {
    const time = this.getTime()
    for (const hook of this.timeHooks) {
      hook(time, global.lx.isPlayedStop)
    }
  },
  clearTimeout() {
    if (!this.bgTimeout) return
    BackgroundTimer.clearTimeout(this.bgTimeout)
    clearInterval(this.timeout!)
    this.bgTimeout = null
    this.timeout = null
    this.time = -1
    this.callHooks()
  },
  start(time: number) {
    this.clearTimeout()
    this.time = time
    this.startTime = performance.now()
    this.bgTimeout = BackgroundTimer.setTimeout(() => {
      this.clearTimeout()
      this.exit()
    }, time * 1000)
    this.timeout = setInterval(() => {
      this.callHooks()
    }, 1000)
  },
  addTimeHook(hook: Hook) {
    this.timeHooks.push(hook)
    hook(this.getTime(), global.lx.isPlayedStop)
  },
  removeTimeHook(hook: Hook) {
    this.timeHooks.splice(this.timeHooks.indexOf(hook), 1)
  },
}


export const startTimeoutExit = (time: number) => {
  timeoutTools.start(time)
}
export const stopTimeoutExit = () => {
  timeoutTools.clearTimeout()
}

export const getTimeoutExitTime = () => {
  return timeoutTools.time
}

export const useTimeoutExitTimeInfo = () => {
  const [info, setInfo] = useState({ time: 0, isPlayedStop: false })
  useEffect(() => {
    const hook: Hook = (time, isPlayedStop) => {
      setInfo({ time, isPlayedStop })
    }
    timeoutTools.addTimeHook(hook)
    return () => { timeoutTools.removeTimeHook(hook) }
  }, [setInfo])

  return info
}

export const onTimeUpdate = (handler: Hook) => {
  timeoutTools.addTimeHook(handler)

  return () => {
    timeoutTools.removeTimeHook(handler)
  }
}


export const cancelTimeoutExit = () => {
  global.lx.isPlayedStop = false
  timeoutTools.callHooks()
}

// ==================== Song Count Mode ====================
const songCountTools = {
  remaining: -1,
  songCountHooks: [] as SongCountHook[],
  fadeOutInterval: null as NodeJS.Timer | null,

  callHooks() {
    for (const hook of this.songCountHooks) hook(this.remaining)
  },
  start(count: number) {
    this.clear()
    this.remaining = count
    this.callHooks()
  },
  clear() {
    this.remaining = -1
    this.stopFadeOut()
    this.callHooks()
  },
  onSongEnd() {
    if (this.remaining < 0) return
    this.remaining--
    this.callHooks()
    if (this.remaining <= 0) {
      if (settingState.setting['player.timeoutExitFadeOut']) {
        this.fadeOutAndExit()
      } else {
        this.clear()
        exitApp('Song Count Exit')
      }
    }
  },
  fadeOutAndExit() {
    const originalVolume = settingState.setting['player.volume']
    const steps = 10
    const stepTime = 300
    let step = 0
    this.fadeOutInterval = setInterval(() => {
      step++
      const vol = Math.max(0, originalVolume * (1 - step / steps))
      void setVolume(vol)
      if (step >= steps) {
        this.stopFadeOut()
        void setVolume(originalVolume)
        this.clear()
        exitApp('Song Count Fade Exit')
      }
    }, stepTime)
  },
  stopFadeOut() {
    if (this.fadeOutInterval) {
      clearInterval(this.fadeOutInterval)
      this.fadeOutInterval = null
    }
  },
  addHook(hook: SongCountHook) {
    this.songCountHooks.push(hook)
    hook(this.remaining)
  },
  removeHook(hook: SongCountHook) {
    this.songCountHooks.splice(this.songCountHooks.indexOf(hook), 1)
  },
}

export const startSongCountExit = (count: number) => {
  songCountTools.start(count)
}
export const stopSongCountExit = () => {
  songCountTools.clear()
}
export const getSongCountRemaining = () => songCountTools.remaining
export const onSongEnd = () => {
  songCountTools.onSongEnd()
}

export const useSongCountInfo = () => {
  const [remaining, setRemaining] = useState(songCountTools.remaining)
  useEffect(() => {
    const hook: SongCountHook = (r) => setRemaining(r)
    songCountTools.addHook(hook)
    return () => { songCountTools.removeHook(hook) }
  }, [])
  return remaining
}
