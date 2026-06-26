import { getListMusics } from '@/core/list'
import settingState from '@/store/setting/state'
import { isSongDownloaded, removeSongDownloaded } from '@/utils/data'
import { existsFile } from '@/utils/fs'
import { isWifi } from '@/utils/network'
import { getPlayQuality } from '@/core/music/utils'
import {
  submitPlayRequest,
  addToBatchQueue,
  startBatchQueue,
  stopBatchQueue,
  clearAllQueues,
  getState,
  getSchedulerStatus,
  removeBatchItem,
  retryAllFailed,
} from './saveScheduler'
import { buildFilePath } from './downloadTask'
import type { SchedulerState } from './saveScheduler'

export type { SchedulerState as DownloadQueueState }
export { submitPlayRequest, getSchedulerStatus }

/**
 * Check if a song exists locally (registry + filesystem).
 * Returns the local file path if found, null otherwise.
 */
export const getLocalPath = async(musicInfo: LX.Music.MusicInfoOnline): Promise<string | null> => {
  const savePath = settingState.setting['download.savePath']
  if (!savePath) return null
  const quality = getPlayQuality(settingState.setting['download.quality'] || settingState.setting['player.playQuality'] || '128k', musicInfo)
  const entry = await isSongDownloaded(musicInfo.id, quality)
  if (entry && await existsFile(entry.filePath)) return entry.filePath
  return null
}

/**
 * Download all songs in a playlist sequentially.
 * Adds all songs to the batch download queue and starts processing.
 */
export const downloadPlaylist = async(listId: string): Promise<number> => {
  const musics = await getListMusics(listId)
  const onlineMusics = musics.filter(
    (m): m is LX.Music.MusicInfoOnline => m.source !== 'local',
  )
  if (onlineMusics.length === 0) return 0

  const added = await addToBatchQueue(onlineMusics)
  startBatchQueue()
  return added
}

export const getDownloadStatus = (): SchedulerState => getState()
export { stopBatchQueue as stopDownload, clearAllQueues as clearDownload }
export { removeBatchItem as removeDownloadItem, retryAllFailed }

/**
 * Check if auto-download features are enabled and configured.
 */
export const isDownloadEnabled = (): boolean => {
  return !!settingState.setting['download.savePath']
}

export const isAutoSaveOnPlay = (): boolean => {
  return settingState.setting['download.isAutoSaveOnPlay'] && isDownloadEnabled()
}

export const isAutoDownloadList = (): boolean => {
  return settingState.setting['download.isAutoDownloadList'] && isDownloadEnabled()
}
