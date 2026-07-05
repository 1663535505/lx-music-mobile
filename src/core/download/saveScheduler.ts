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
let paused = false
let isProcessing = false
let generation = 0

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
  console.log(`[DL] submitPlayRequest: name="${musicInfo.name}" id=${musicInfo.id} source=${musicInfo.source} hasInitialUrl=${!!initialUrl}`)
  await restoreQueues()

  const quality = getQuality(musicInfo)
  const savePath = settingState.setting['download.savePath']
  if (!savePath) { console.log('[DL] submitPlayRequest: ERROR - savePath not set'); onError('Save path not set'); return }

  console.log(`[DL] submitPlayRequest: quality=${quality} savePath=${savePath.substring(0, 50)}`)

  // Check local registry
  const entry = await isSongDownloaded(musicInfo.id, quality)
  if (entry) {
    if (await existsFile(entry.filePath)) {
      console.log(`[DL] submitPlayRequest: LOCAL HIT id=${musicInfo.id} path="${entry.filePath}"`)
      onComplete(entry.filePath)
      schedulePendingCheck()
      return
    }
    console.log(`[DL] submitPlayRequest: registry entry exists but file missing, removing id=${musicInfo.id}`)
    await import('@/utils/data').then(m => m.removeSongDownloaded(musicInfo.id, quality))
  }

  // Cancel current download if needed
  if (currentAbort) {
    currentAbort()
    currentAbort = null
  }

  // Move current play task to pending
  if (playTask && playTask.status === 'downloading') {
    playTask.status = 'waiting'
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
  console.log('[DL] STATE: status', status, '-> downloading_play')
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
    console.log(`[DL] processPlayDownload: using initialUrl for "${musicInfo.name}" url=${url.substring(0, 80)}`)
  } else {
    console.log(`[DL] processPlayDownload: fetching URL for "${musicInfo.name}" quality=${quality}`)
    setStatusText('正在获取URL...')
    try {
      url = await getMusicUrl({ musicInfo, quality, isRefresh: false })
      console.log(`[DL] processPlayDownload: URL OK for "${musicInfo.name}" url=${url.substring(0, 80)}`)
    } catch (err1: any) {
      console.log(`[DL] processPlayDownload: URL FAIL (1st) for "${musicInfo.name}" err="${err1.message}"`)
      try {
        url = await getMusicUrl({ musicInfo, quality, isRefresh: true })
        console.log(`[DL] processPlayDownload: URL OK (retry) for "${musicInfo.name}" url=${url.substring(0, 80)}`)
      } catch (err: any) {
        console.log(`[DL] processPlayDownload: URL FAIL (2nd) for "${musicInfo.name}" err="${err.message}"`)
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

  console.log(`[DL] processPlayDownload: starting download for "${musicInfo.name}" id=${task.id}`)
  setStatusText('正在下载... 0%')
  task.status = 'downloading'
  notifyUpdate()

  // Download with cancellation support
  const filePath = buildFilePath(musicInfo, savePath, quality)
  const tempPath = buildTempPath(filePath)
  console.log(`[DL] processPlayDownload: filePath="${filePath}" tempPath="${tempPath}"`)

  const { promise, cancel } = downloadSingleSong(musicInfo, savePath, url, (downloaded, total) => {
    task.downloaded = downloaded
    task.total = total
    task.progress = total > 0 ? Math.round((downloaded / total) * 100) : 0
    setStatusText(`正在下载... ${task.progress}%`)
    notifyUpdate()
  })

  currentAbort = cancel

  const result = await promise
  console.log(`[DL] processPlayDownload: download result for "${musicInfo.name}" success=${result.success} filePath=${result.filePath} error=${result.error}`)

  // If this task was preempted, don't process result
  if (!playTask || playTask.id !== task.id) { console.log(`[DL] processPlayDownload: task preempted, discarding result`); return }

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
    // Clear playTask after a delay so UI can show completion briefly
    setTimeout(() => {
      if (playTask?.id === task.id) {
        playTask = null
        if (status === 'playing') status = 'idle'
        notifyUpdate()
      }
    }, 3000)
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
      const gen = generation
      setTimeout(() => {
        if (generation !== gen) return
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
  console.log('[DL] processNextBackgroundTask: status =', status, 'isProcessing =', isProcessing, 'hasAbort =', !!currentAbort, 'paused =', paused, 'pending =', pendingQueue.length, 'batch =', batchQueue.length)
  if (status === 'downloading_play') return
  if (isProcessing) return // prevent concurrent execution
  if (currentAbort) return // already downloading
  if (paused) return // paused by user
  isProcessing = true

  const savePath = settingState.setting['download.savePath']
  if (!savePath) { console.log('[DL] processNextBackgroundTask: ABORT - no savePath'); isProcessing = false; return }

  // wifi-only check
  if (settingState.setting['download.wifiOnly']) {
    const wifi = await isWifi()
    if (wifi === false) { console.log('[DL] processNextBackgroundTask: ABORT - wifiOnly and not wifi'); isProcessing = false; return }
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
    const idx = batchQueue.findIndex(t => t.status === 'waiting')
    if (idx !== -1) {
      task = batchQueue[idx]
      source = 'batch'
    }
  }

  if (!task) {
    console.log('[DL] processNextBackgroundTask: NO TASK found, setting idle')
    if (status !== 'playing') status = 'idle'
    isProcessing = false
    notifyUpdate()
    return
  }

  console.log('[DL] processNextBackgroundTask: PICKED task -', task.musicInfo.name, 'id:', task.id, 'source:', source, 'quality:', task.quality)
  status = source === 'pending' ? 'downloading_pending' : 'downloading_batch'
  task.status = 'downloading'
  task.progress = 0
  task.downloaded = 0
  task.total = 0
  notifyUpdate()
  isProcessing = false

  await processBackgroundDownload(task, savePath, source)
}

const processBackgroundDownload = async(task: SchedulerTask, savePath: string, source: 'pending' | 'batch') => {
  const musicInfo = task.musicInfo
  const quality = task.quality
  console.log('[DL] processBackgroundDownload: START -', musicInfo.name, 'quality:', quality, 'savePath:', savePath.substring(0, 50))

  // Check if already downloaded
  const entry = await isSongDownloaded(musicInfo.id, quality)
  if (entry && await existsFile(entry.filePath)) {
    console.log('[DL] processBackgroundDownload: SKIP (already downloaded) -', musicInfo.name, 'filePath:', entry.filePath)
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
    console.log('[DL] processBackgroundDownload: URL OK -', musicInfo.name, 'url:', url.substring(0, 80))
  } catch (err1: any) {
    console.log('[DL] processBackgroundDownload: URL FAIL (1st) -', musicInfo.name, 'err:', err1.message)
    try {
      url = await getMusicUrl({ musicInfo, quality, isRefresh: true })
      console.log('[DL] processBackgroundDownload: URL OK (retry) -', musicInfo.name, 'url:', url.substring(0, 80))
    } catch (err: any) {
      console.log('[DL] processBackgroundDownload: URL FAIL (2nd) -', musicInfo.name, 'err:', err.message)
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
    task.progress = 0
    task.downloaded = 0
    if (source === 'pending') pendingQueue.unshift(task)
    notifyUpdate()
    persistQueues()
    return
  }

  // Download
  if (currentAbort) {
    currentAbort()
    currentAbort = null
  }
  const { promise, cancel } = downloadSingleSong(musicInfo, savePath, url, (downloaded, total) => {
    task.downloaded = downloaded
    task.total = total
    task.progress = total > 0 ? Math.round((downloaded / total) * 100) : 0
    notifyUpdate()
  })

  currentAbort = cancel

  const result = await promise
  currentAbort = null
  console.log('[DL] processBackgroundDownload: DOWNLOAD RESULT -', musicInfo.name, 'success:', result.success, 'filePath:', result.filePath, 'error:', result.error)

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
      console.log(`[DL] processBackgroundDownload: RETRYING "${musicInfo.name}" attempt=${task.retryCount}/${getRetryConfig().maxRetries} delay=${Math.round(delay / 1000)}s`)
      notifyUpdate()
      persistQueues()
      // Schedule retry after delay
      const gen = generation
      setTimeout(() => {
        if (generation !== gen) return
        if (status !== 'downloading_play' && task.status === 'waiting') {
          void processBackgroundDownload(task, savePath, source)
        }
      }, delay)
      return
    } else {
      console.log(`[DL] processBackgroundDownload: RETRIES EXHAUSTED "${musicInfo.name}" retryCount=${task.retryCount} -> marking error`)
      task.status = 'error'
    }
  }

  notifyUpdate()
  persistQueues()

  // If preempted during download, don't continue (status may change during await)
  if ((status as string) === 'downloading_play') {
    if ((task.status as string) === 'downloading') {
      task.status = 'waiting'
      task.progress = 0
      task.downloaded = 0
    }
    return
  }

  // Process next
  void processNextBackgroundTask()
}

// ==================== Batch queue ====================
export const addToBatchQueue = async(musicInfos: LX.Music.MusicInfoOnline[]): Promise<number> => {
  console.log('[DL] addToBatchQueue: input count =', musicInfos.length)
  await restoreQueues()
  let added = 0
  for (const info of musicInfos) {
    if (playTask?.id === info.id) {
      console.log('[DL] addToBatchQueue: skip (playTask) -', info.name, info.id)
      continue
    }
    if (pendingQueue.some(t => t.id === info.id)) {
      console.log('[DL] addToBatchQueue: skip (pendingQueue) -', info.name, info.id)
      continue
    }
    if (batchQueue.some(t => t.id === info.id)) {
      console.log('[DL] addToBatchQueue: skip (batchQueue) -', info.name, info.id)
      continue
    }

    const quality = getQuality(info)
    const entry = await isSongDownloaded(info.id, quality)
    if (entry) {
      console.log('[DL] addToBatchQueue: skip (registry) -', info.name, info.id, 'quality:', quality, 'filePath:', entry.filePath)
      continue
    }

    console.log('[DL] addToBatchQueue: ADD -', info.name, info.id, 'source:', info.source, 'quality:', quality, '_qualitys:', JSON.stringify(info.meta?._qualitys))
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
  console.log('[DL] addToBatchQueue: added =', added, 'batchQueue.length =', batchQueue.length, 'status =', status)
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
    // Reset the active task back to waiting so it can be retried
    const activeQueue = status === 'downloading_pending' ? pendingQueue : batchQueue
    const activeTask = activeQueue.find(t => t.status === 'downloading')
    if (activeTask) {
      activeTask.status = 'waiting'
      activeTask.progress = 0
      activeTask.downloaded = 0
    }
    currentAbort()
    currentAbort = null
  }
  status = 'idle'
  notifyUpdate()
  persistQueues()
}

export const pauseAllDownloads = () => {
  paused = true
  // Stop current download if it's a batch/pending download
  if (currentAbort && (status === 'downloading_batch' || status === 'downloading_pending')) {
    // Reset the active task back to waiting so it can resume later
    const activeQueue = status === 'downloading_pending' ? pendingQueue : batchQueue
    const activeTask = activeQueue.find(t => t.status === 'downloading')
    if (activeTask) {
      activeTask.status = 'waiting'
      activeTask.progress = 0
      activeTask.downloaded = 0
    }
    currentAbort()
    currentAbort = null
    status = 'idle'
  }
  notifyUpdate()
  persistQueues()
}

export const resumeAllDownloads = () => {
  paused = false
  notifyUpdate()
  // Start processing if idle
  if (status === 'idle') void processNextBackgroundTask()
}

export const isPaused = () => paused

export const clearAllQueues = () => {
  generation++
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
  isProcessing = false
  paused = false
  notifyUpdate()
  void clearDownloadQueueStorage()
}

export const removeBatchItem = (id: string) => {
  // If this item is currently being downloaded, cancel it
  if (currentAbort && (status === 'downloading_batch' || status === 'downloading_pending')) {
    const activeTask = status === 'downloading_pending'
      ? pendingQueue.find(t => t.id === id)
      : batchQueue.find(t => t.id === id)
    if (activeTask && activeTask.status === 'downloading') {
      currentAbort()
      currentAbort = null
      status = 'idle'
    }
  }
  removePending(id)
  removeBatch(id)
  notifyUpdate()
  persistQueues()
  // Resume processing if idle
  if (status === 'idle') void processNextBackgroundTask()
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
