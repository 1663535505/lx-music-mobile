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
  // For SAF URIs, use a temporary directory instead of appending to the URI
  if (filePath.startsWith('content://')) {
    const { temporaryDirectoryPath } = require('@/utils/fs')
    const fileName = filePath.substring(filePath.lastIndexOf('/') + 1)
    return `${temporaryDirectoryPath}/${fileName}.downloading`
  }
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
    // Check if savePath is a SAF URI (content://) or a regular file path
    const isSafUri = savePath.startsWith('content://')
    console.log(`[DL] downloadSingleSong: START name="${musicInfo.name}" id=${musicInfo.id} quality=${quality} isSafUri=${isSafUri}`)
    console.log(`[DL] downloadSingleSong: savePath="${savePath}"`)
    console.log(`[DL] downloadSingleSong: filePath="${filePath}" tempPath="${tempPath}"`)
    const startDownload = async() => {
      // For regular file paths, ensure save directory exists
      // For SAF URIs, the directory should already exist (user selected it via SAF)
      if (!isSafUri) {
        const dir = savePath.substring(0, savePath.lastIndexOf('/'))
        if (dir && !await existsFile(dir)) {
          await mkdir(dir)
        }
      }

      if (isSafUri) {
        try {
          const { existsFile: _exists } = require('@/utils/fs')
          const parentExists = await _exists(savePath)
          console.log(`[DL] downloadSingleSong: SAF parentExists=${parentExists} parentPath="${savePath}"`)
        } catch (e: any) {
          console.log(`[DL] downloadSingleSong: SAF parent check ERROR err="${e.message}"`)
        }
      }

      // For SAF URIs, download to a temporary location first, then move
      // react-native-fs doesn't support SAF URIs directly
      const downloadTarget = isSafUri ? tempPath : tempPath

      try {
        const result = downloadFile(url, downloadTarget, {
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
          void unlink(downloadTarget).catch(() => {})
          resolve({ success: false, error: 'cancelled' })
          return
        }

        console.log(`[DL] downloadSingleSong: download complete for "${musicInfo.name}", moving temp -> final`)

        // Rename temp file to final path
        try {
          const fileExists = await existsFile(filePath)
          console.log(`[DL] downloadSingleSong: existsFile(filePath)=${fileExists}`)
          if (fileExists) {
            await unlink(filePath)
            console.log(`[DL] downloadSingleSong: unlinked existing file`)
          }
        } catch (exErr: any) {
          console.log(`[DL] downloadSingleSong: existsFile/unlink ERROR err="${exErr.message}"`)
        }

        // Use react-native-file-system for SAF URIs, react-native-fs for regular paths
        if (isSafUri) {
          const { moveFile } = require('@/utils/fs')
          try {
            console.log(`[DL] downloadSingleSong: calling moveFile(${downloadTarget.substring(0, 40)}... -> ${filePath.substring(0, 60)}...)`)
            await moveFile(downloadTarget, filePath)
            console.log(`[DL] downloadSingleSong: moveFile SUCCESS`)
          } catch (mvErr: any) {
            console.log(`[DL] downloadSingleSong: moveFile FAILED err="${mvErr.message}" code=${mvErr.code}`)
            // Fallback: read binary from temp, write to SAF URI
            try {
              console.log(`[DL] downloadSingleSong: trying readFile+writeFile fallback...`)
              const RNFS = require('react-native-fs')
              const base64Data = await RNFS.readFile(downloadTarget, 'base64')
              console.log(`[DL] downloadSingleSong: readFile OK, size=${base64Data.length} chars`)
              const { writeFile: safWriteFile } = require('@/utils/fs')
              await safWriteFile(filePath, base64Data, 'base64')
              console.log(`[DL] downloadSingleSong: writeFile fallback SUCCESS`)
              await unlink(downloadTarget).catch(() => {})
            } catch (fallbackErr: any) {
              console.log(`[DL] downloadSingleSong: writeFile fallback FAILED err="${fallbackErr.message}"`)
              throw fallbackErr
            }
          }
        } else {
          const RNFS = require('react-native-fs')
          await RNFS.moveFile(downloadTarget, filePath)
        }

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

        console.log(`[DL] downloadSingleSong: SUCCESS name="${musicInfo.name}" filePath="${filePath}"`)
        resolve({ success: true, filePath })
      } catch (err: any) {
        console.log(`[DL] downloadSingleSong: ERROR name="${musicInfo.name}" err="${err.message}" code=${err.code}`)
        if (cancelled) {
          void unlink(downloadTarget).catch(() => {})
          resolve({ success: false, error: 'cancelled' })
          return
        }
        // Clean up temp file on error
        void unlink(downloadTarget).catch(() => {})
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
