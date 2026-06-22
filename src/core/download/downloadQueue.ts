import {
  addToBatchQueue,
  startBatchQueue,
  stopBatchQueue,
  clearAllQueues,
  getState as getSchedulerState,
  removeBatchItem,
  getSchedulerStatus,
  type SchedulerState,
} from './saveScheduler'

export type { SchedulerState as DownloadQueueState } from './saveScheduler'

export const addToQueue = addToBatchQueue

export const startQueue = startBatchQueue

export const stopQueue = stopBatchQueue

export const clearQueue = clearAllQueues

export const getState = getSchedulerState

export const getQueueStatus = getSchedulerStatus

export const removeQueueItem = removeBatchItem
