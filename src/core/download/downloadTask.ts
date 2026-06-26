import { downloadFile, existsFile, mkdir, unlink } from '@/utils/fs'
import { formatMusicName } from '@/utils/tools'
import { getRandom } from '@/utils/common'
import settingState from '@/store/setting/state'
import type { DownloadTaskResult } from './types'
import { writeTagsToFile } from './tagWriter'

const getExtFromQuality = (quality: LX.Quality): string => {
  switch (quality) {
    case 'flac24bit':
    case 'flac': return 'flac'
    case '320k': return 'mp3'
    case '128k':
    default: return 'mp3'
  }
}

const sanitizeFileName = (name: string): string => {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
}

export const buildFilePath = (
  musicInfo: LX.Music.MusicInfoOnline,
  savePath: string,
  quality: LX.Quality,
): string => {
  const fileNameFormat = settingState.setting['download.fileName']
  const ext = getExtFromQuality(quality)
  const fileName = sanitizeFileName(formatMusicName(fileNameFormat, musicInfo.name, musicInfo.singer))
  return `${savePath}/${fileName}.${ext}`
}

export const buildTempPath = (filePath: string): string => {
  return filePath + '.downloading'
}

export type CancelDownloadFn = () => void

/**
 * Download a song file with cancellation support.
 * URL must be resolved by the caller (scheduler).
 * Returns { promise, cancel } - call cancel() to abort the download.
 */
export const downloadSingleSong = (
  musicInfo: LX.Music.MusicInfoOnline,
  savePath: string,
  url: string,
  onProgress?: (downloaded: number, total: number) => void,
): { promise: Promise<DownloadTaskResult>; cancel: CancelDownloadFn } => {
  const quality = settingState.setting['download.quality'] || settingState.setting['player.playQuality'] || '128k'
  const filePath = buildFilePath(musicInfo, savePath, quality)
  const tempPath = buildTempPath(filePath)

  let cancelled = false
  let jobId: number | null = null

  const promise = new Promise<DownloadTaskResult>((resolve) => {
    // Ensure save directory exists
    const dir = savePath.substring(0, savePath.lastIndexOf('/'))
    const startDownload = async() => {
      if (dir && !await existsFile(dir)) {
        await mkdir(dir)
      }

      try {
        const result = downloadFile(url, tempPath, {
          progressInterval: 500,
          connectionTimeout: 30000,
          readTimeout: 60000,
          progress({ contentLength, bytesWritten }) {
            if (!cancelled) onProgress?.(bytesWritten, contentLength)
          },
        })
        jobId = result.jobId
        await result.promise

        if (cancelled) {
          // Clean up temp file on cancellation
          void unlink(tempPath).catch(() => {})
          resolve({ success: false, error: 'cancelled' })
          return
        }

        // Rename temp file to final path
        if (await existsFile(filePath)) {
          await unlink(filePath)
        }
        const RNFS = require('react-native-fs')
        await RNFS.moveFile(tempPath, filePath)

        // Write metadata tags if enabled
        if (settingState.setting['download.isWriteTag']) {
          try {
            await writeTagsToFile(filePath, {
              name: musicInfo.name,
              singer: musicInfo.singer,
              albumName: musicInfo.meta.albumName || '',
              picUrl: musicInfo.meta.picUrl,
            })
          } catch {
            // Tag writing failure is non-fatal
          }
        }

        resolve({ success: true, filePath })
      } catch (err: any) {
        if (cancelled) {
          void unlink(tempPath).catch(() => {})
          resolve({ success: false, error: 'cancelled' })
          return
        }
        // Clean up temp file on error
        void unlink(tempPath).catch(() => {})
        resolve({ success: false, error: err.message || 'Download failed' })
      }
    }

    void startDownload()
  })

  const cancel: CancelDownloadFn = () => {
    cancelled = true
    if (jobId !== null) {
      try {
        const { stopDownload } = require('@/utils/fs')
        stopDownload(jobId)
      } catch {
        // ignore
      }
    }
  }

  return { promise, cancel }
}

export const delayBetweenDownloads = (): Promise<void> => {
  const seconds = getRandom(2, 6)
  return new Promise(resolve => setTimeout(resolve, seconds * 1000))
}
