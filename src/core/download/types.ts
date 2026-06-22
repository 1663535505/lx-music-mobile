export interface DownloadTaskResult {
  success: boolean
  filePath?: string
  skipped?: boolean
  error?: string
}

export interface QueueItem {
  id: string
  musicInfo: LX.Music.MusicInfoOnline
  status: 'waiting' | 'downloading' | 'completed' | 'error' | 'skipped'
  progress: number
  downloaded: number
  total: number
  error?: string
}

export type QueueStatus = 'idle' | 'running' | 'stopped'

export interface DownloadQueueState {
  status: QueueStatus
  queue: QueueItem[]
  currentIndex: number
  totalCompleted: number
  totalSkipped: number
  totalError: number
}
