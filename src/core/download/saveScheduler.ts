import settingState from '@/store/setting/state'
import { getMusicUrl } from '@/core/music/online'
import { getPlayQuality } from '@/core/music/utils'
import { isSongDownloaded, setSongDownloaded, saveDownloadQueue, getDownloadQueue, clearDownloadQueueStorage } from '@/utils/data'
import { existsFile, unlink } from '@/utils/fs'
import { isWifi } from '@/utils/network'
import { setStatusText } from '@/core/player/playStatus'
import { toast } from '@/utils/tools'
import { downloadSingleSong, buildFilePath, buildTempPath, type CancelDownloadFn } from './downloadTask'
import type { DownloadTaskResult } from './types'
import { shouldRetry, getRetryDelay, getRetryConfig } from './retryPolicy'

// ==================== Types ====================
export interface SchedulerTask {
  id: string
  musicInfo: LX.Music.MusicInfoOnline
  quality: LX.Quality
  status: 'waiting' | 'downloading' | 'completed' | 'skipped' | 'error' | 'cancelled'
  progress: number
  downloaded: number
  total: number
  error?: string
  retryCount: number
}

export interface SchedulerState {
  playTask: SchedulerTask | null
  pendingQueue: SchedulerTask[]
  batchQueue: SchedulerTask[]
  currentDownloading: 'play' | 'pending' | 'batch' | null
}

type SchedulerStatus = 'idle' | 'downloading_play' | 'playing' | 'downloading_pending' | 'downloading_batch'

// ==================== State ====================
let status: SchedulerStatus = 'idle'
let playTask: SchedulerTask | null = null
let pendingQueue: SchedulerTask[] = []
let batchQueue: SchedulerTask[] = []
let currentAbort: CancelDownloadFn | null = null
let playStartTime = 0
let pendingTimer: ReturnType<typeof setTimeout> | null = null
let restored = false

// ==================== Notification ====================
const notifyUpdate = () => {
  global.app_event.downloadProgressUpdate(getState())
}

export const getState = (): SchedulerState => ({
  playTask,
  pendingQueue: [...pendingQueue],
  batchQueue: [...batchQueue],
  currentDownloading: status === 'downloading_play' ? 'play'
    : status === 'downloading_pending' ? 'pending'
    : status === 'downloading_batch' ? 'batch'
    : null,
})

export const getSchedulerStatus = (): SchedulerStatus => status

// ==================== Persistence ====================
const persistQueues = () => {
  const toPersist = [...pendingQueue, ...batchQueue]
    .filter(t => t.status === 'waiting' || t.status === 'error')
    .map(t => ({ id: t.id, musicInfo: t.musicInfo, quality: t.quality, status: t.status as 'waiting' | 'error', error: t.error }))
  void saveDownloadQueue(toPersist)
}

const restoreQueues = async() => {
  if (restored) return
  restored = true
  const persisted = await getDownloadQueue()
  if (persisted.length === 0) return
  for (const item of persisted) {
    if (pendingQueue.some(t => t.id === item.id) || batchQueue.some(t => t.id === item.id)) continue
    const task: SchedulerTask = {
      id: item.id,
      musicInfo: item.musicInfo,
      quality: (('quality' in item ? (item as any).quality : undefined) ?? settingState.setting['download.quality']) || settingState.setting['player.playQuality'] || '128k',
      status: item.status,
      progress: 0,
      downloaded: 0,
      total: 0,
      error: item.error,
      retryCount: 0,
    }
    // restore to batch queue (generic restore)
    batchQueue.push(task)
  }
  notifyUpdate()
}

// ==================== Helpers ====================
const getQuality = (musicInfo: LX.Music.MusicInfoOnline): LX.Quality => {
  const preferred = settingState.setting['download.quality'] || settingState.setting['player.playQuality'] || '128k'
  return getPlayQuality(preferred, musicInfo)
}

const removePending = (id: string) => {
  const idx = pendingQueue.findIndex(t => t.id === id)
  if (idx !== -1) pendingQueue.splice(idx, 1)
}

const removeBatch = (id: string) => {
  const idx = batchQueue.findIndex(t => t.id === id)
  if (idx !== -1) batchQueue.splice(idx, 1)
}

const clearPendingTimer = () => {
  if (pendingTimer) {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
}

const isDownloadEnabled = (): boolean => !!settingState.setting['download.savePath']

// ==================== Play request ====================
export const submitPlayRequest = async(
  musicInfo: LX.Music.MusicInfoOnline,
  onComplete: (localPath: string) => void,
  onError: (err: string) => void,
  initialUrl?: string,
) => {
  await restoreQueues()

  const quality = getQuality(musicInfo)
  const savePath = settingState.setting['download.savePath']
  if (!savePath) { onError('Save path not set'); return }

  // Check local registry
  const entry = await isSongDownloaded(musicInfo.id, quality)
  if (entry) {
    if (await existsFile(entry.filePath)) {
      onComplete(entry.filePath)
      schedulePendingCheck()
      return
    }
    await import('@/utils/data').then(m => m.removeSongDownloaded(musicInfo.id, quality))
  }

  // Cancel current download if needed
  if (currentAbort) {
    currentAbort()
    currentAbort = null
  }

  // Move current play task to pending
  if (playTask && playTask.status === 'downloading') {
    playTask.status = 'cancelled'
    playTask.progress = 0
    playTask.downloaded = 0
    pendingQueue.unshift(playTask)
  }

  // Create new play task
  const task: SchedulerTask = {
    id: musicInfo.id,
    musicInfo,
    quality,
    status: 'waiting',
    progress: 0,
    downloaded: 0,
    total: 0,
    retryCount: 0,
  }
  playTask = task
  status = 'downloading_play'
  playStartTime = 0
  clearPendingTimer()
  notifyUpdate()

  // Start download (pass URL to avoid double fetch)
  void processPlayDownload(savePath, onComplete, onError, initialUrl)
}

// ==================== Play download processing ====================
const processPlayDownload = async(
  savePath: string,
  onComplete: (localPath: string) => void,
  onError: (err: string) => void,
  initialUrl?: string,
) => {
  if (!playTask) return
  const task = playTask
  const musicInfo = task.musicInfo
  const quality = task.quality

  // Use provided URL or fetch one
  let url: string
  if (initialUrl) {
    url = initialUrl
  } else {
    setStatusText('正在获取URL...')
    try {
      url = await getMusicUrl({ musicInfo, quality, isRefresh: false })
    } catch {
      try {
        url = await getMusicUrl({ musicInfo, quality, isRefresh: true })
      } catch (err: any) {
        task.status = 'error'
        task.error = err.message || 'Failed to get URL'
        setStatusText(task.error!)
        onError(task.error!)
        notifyUpdate()
        persistQueues()
        schedulePendingCheck()
        return
      }
    }
  }

  if (!playTask || playTask.id !== task.id) return // preempted during URL fetch

  setStatusText('正在下载... 0%')
  task.status = 'downloading'
  notifyUpdate()

  // Download with cancellation support
  const filePath = buildFilePath(musicInfo, savePath, quality)
  const tempPath = buildTempPath(filePath)

  const { promise, cancel } = downloadSingleSong(musicInfo, savePath, url, (downloaded, total) => {
    task.downloaded = downloaded
    task.total = total
    task.progress = total > 0 ? Math.round((downloaded / total) * 100) : 0
    setStatusText(`正在下载... ${task.progress}%`)
    notifyUpdate()
  })

  currentAbort = cancel

  const result = await promise

  // If this task was preempted, don't process result
  if (!playTask || playTask.id !== task.id) return

  currentAbort = null

  if (result.success && result.filePath) {
    task.status = 'completed'
    task.progress = 100
    playStartTime = Date.now()
    status = 'playing'
    await setSongDownloaded(musicInfo.id, quality, result.filePath)
    notifyUpdate()
    persistQueues()
    onComplete(result.filePath)
    // After play starts, schedule pending queue processing
    schedulePendingCheck()
  } else {
    task.error = result.error || 'Download failed'

    // Check if we should retry
    if (shouldRetry(task.retryCount)) {
      task.retryCount++
      task.status = 'waiting'
      const delay = getRetryDelay(task.retryCount - 1)
      setStatusText(`下载失败，${Math.round(delay / 1000)}秒后重试 (${task.retryCount}/${getRetryConfig().maxRetries})...`)
      notifyUpdate()
      persistQueues()
      setTimeout(() => {
        if (playTask && playTask.id === task.id && playTask.status === 'waiting') {
          void processPlayDownload(savePath, onComplete, onError)
        }
      }, delay)
    } else {
      task.status = 'error'
      setStatusText(task.error)
      onError(task.error)
      notifyUpdate()
      persistQueues()
      schedulePendingCheck()
    }
  }
}

// ==================== Pending queue scheduling ====================
const schedulePendingCheck = () => {
  clearPendingTimer()
  if (pendingQueue.length === 0 && batchQueue.length === 0) return
  if (status === 'downloading_play') return

  // Wait 5 seconds after play starts before processing pending/batch
  if (playStartTime > 0 && status === 'playing') {
    const elapsed = Date.now() - playStartTime
    const remaining = Math.max(0, 5000 - elapsed)
    pendingTimer = setTimeout(() => {
      processNextBackgroundTask()
    }, remaining)
  } else if (status === 'idle') {
    // No play task, process immediately
    void processNextBackgroundTask()
  }
}

const processNextBackgroundTask = async() => {
  if (status === 'downloading_play') return
  if (currentAbort) return // already downloading

  const savePath = settingState.setting['download.savePath']
  if (!savePath) return

  // wifi-only check
  if (settingState.setting['download.wifiOnly']) {
    const wifi = await isWifi()
    if (wifi === false) return
  }

  // Pick next task: pending first, then batch
  let task: SchedulerTask | null = null
  let source: 'pending' | 'batch' = 'pending'

  if (pendingQueue.length > 0) {
    // Filter out completed/error tasks
    const idx = pendingQueue.findIndex(t => t.status === 'waiting' || t.status === 'cancelled')
    if (idx !== -1) {
      task = pendingQueue[idx]
      pendingQueue.splice(idx, 1)
      source = 'pending'
    }
  }

  if (!task && batchQueue.length > 0) {
    const idx = batchQueue.findIndex(t => t.status === 'waiting' || t.status === 'error')
    if (idx !== -1) {
      task = batchQueue[idx]
      source = 'batch'
    }
  }

  if (!task) {
    if (status !== 'playing') status = 'idle'
    notifyUpdate()
    return
  }

  status = source === 'pending' ? 'downloading_pending' : 'downloading_batch'
  task.status = 'downloading'
  task.progress = 0
  task.downloaded = 0
  task.total = 0
  notifyUpdate()

  await processBackgroundDownload(task, savePath, source)
}

const processBackgroundDownload = async(task: SchedulerTask, savePath: string, source: 'pending' | 'batch') => {
  const musicInfo = task.musicInfo
  const quality = task.quality

  // Check if already downloaded
  const entry = await isSongDownloaded(musicInfo.id, quality)
  if (entry && await existsFile(entry.filePath)) {
    task.status = 'skipped'
    task.progress = 100
    notifyUpdate()
    persistQueues()
    // Process next
    void processNextBackgroundTask()
    return
  }

  // Fetch URL
  let url: string
  try {
    url = await getMusicUrl({ musicInfo, quality, isRefresh: false })
  } catch {
    try {
      url = await getMusicUrl({ musicInfo, quality, isRefresh: true })
    } catch (err: any) {
      task.status = 'error'
      task.error = err.message || 'Failed to get URL'
      notifyUpdate()
      persistQueues()
      void processNextBackgroundTask()
      return
    }
  }

  // Check if preempted during URL fetch
  if (status === 'downloading_play') {
    task.status = 'waiting'
    if (source === 'pending') pendingQueue.unshift(task)
    notifyUpdate()
    return
  }

  // Download
  const { promise, cancel } = downloadSingleSong(musicInfo, savePath, url, (downloaded, total) => {
    task.downloaded = downloaded
    task.total = total
    task.progress = total > 0 ? Math.round((downloaded / total) * 100) : 0
    notifyUpdate()
  })

  currentAbort = cancel

  const result = await promise
  currentAbort = null

  if (result.success && result.filePath) {
    task.status = 'completed'
    task.progress = 100
    await setSongDownloaded(musicInfo.id, quality, result.filePath)
  } else if (task.status !== 'cancelled') {
    task.error = result.error || 'Download failed'

    // Check if we should retry
    if (shouldRetry(task.retryCount)) {
      task.retryCount++
      task.status = 'waiting'
      const delay = getRetryDelay(task.retryCount - 1)
      notifyUpdate()
      persistQueues()
      // Schedule retry after delay
      setTimeout(() => {
        if (status !== 'downloading_play' && task.status === 'waiting') {
          void processBackgroundDownload(task, savePath, source)
        }
      }, delay)
      return
    } else {
      task.status = 'error'
    }
  }

  notifyUpdate()
  persistQueues()

  // If preempted during download, don't continue (status may change during await)
  if ((status as string) === 'downloading_play') return

  // Process next
  void processNextBackgroundTask()
}

// ==================== Batch queue ====================
export const addToBatchQueue = async(musicInfos: LX.Music.MusicInfoOnline[]): Promise<number> => {
  await restoreQueues()
  let added = 0
  for (const info of musicInfos) {
    if (playTask?.id === info.id) continue
    if (pendingQueue.some(t => t.id === info.id)) continue
    if (batchQueue.some(t => t.id === info.id)) continue

    const quality = getQuality(info)
    const entry = await isSongDownloaded(info.id, quality)
    if (entry) continue

    batchQueue.push({
      id: info.id,
      musicInfo: info,
      quality,
      status: 'waiting',
      progress: 0,
      downloaded: 0,
      total: 0,
      retryCount: 0,
    })
    added++
  }
  if (added > 0) {
    notifyUpdate()
    persistQueues()
    // Start processing if idle
    if (status === 'idle') void processNextBackgroundTask()
  }
  return added
}

export const startBatchQueue = () => {
  if (status === 'idle') void processNextBackgroundTask()
}

export const stopBatchQueue = () => {
  if (currentAbort && (status === 'downloading_batch' || status === 'downloading_pending')) {
    currentAbort()
    currentAbort = null
  }
  status = 'idle'
  notifyUpdate()
}

export const clearAllQueues = () => {
  clearPendingTimer()
  if (currentAbort) {
    currentAbort()
    currentAbort = null
  }
  playTask = null
  pendingQueue = []
  batchQueue = []
  status = 'idle'
  playStartTime = 0
  notifyUpdate()
  void clearDownloadQueueStorage()
}

export const removeBatchItem = (id: string) => {
  removeBatch(id)
  notifyUpdate()
  persistQueues()
}

export const retryAllFailed = () => {
  let hasRetry = false
  for (const task of pendingQueue) {
    if (task.status === 'error') {
      task.status = 'waiting'
      task.retryCount = 0
      hasRetry = true
    }
  }
  for (const task of batchQueue) {
    if (task.status === 'error') {
      task.status = 'waiting'
      task.retryCount = 0
      hasRetry = true
    }
  }
  if (hasRetry) {
    notifyUpdate()
    persistQueues()
    if (status === 'idle') void processNextBackgroundTask()
  }
}
